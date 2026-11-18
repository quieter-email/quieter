import type { RouterOutputs } from "@quieter/orpc";
import { describe, expect, test, vi } from "vite-plus/test";

import { recoverCanceledHeldSend } from "./canceled-held-send";
import type { CanceledHeldSendCapture } from "./canceled-held-send";

type HeldSendStatus = RouterOutputs["mail"]["getHeldSend"];
const capture: CanceledHeldSendCapture = {
  assistantMessageId: "exchange",
  chatId: "chat",
  draftId: "original-local",
  draftRevision: 3,
  mailboxId: "mailbox",
  sendOperationId: "operation",
  userId: "actor",
};
const status: HeldSendStatus = {
  canUndo: false,
  draftId: "restored-provider",
  errorMessage: null,
  id: "held-row",
  mailboxId: capture.mailboxId,
  sendOperationId: capture.sendOperationId,
  status: "canceled",
  undoUntil: null,
};

describe("canceled foreground held-send recovery", () => {
  test("waits for cancellation and keeps original local identity separate from restored status", async () => {
    const canceled = Promise.withResolvers<unknown>();
    const readStatus = vi
      .fn<() => Promise<HeldSendStatus>>()
      .mockResolvedValue(status);
    const pending = recoverCanceledHeldSend({
      cancel: async () => await canceled.promise,
      capture,
      isCurrent: () => true,
      readStatus,
    });
    expect(readStatus).not.toHaveBeenCalled();
    canceled.resolve({ cancelled: true });
    await expect(pending).resolves.toMatchObject({
      draftId: capture.draftId,
      draftRevision: capture.draftRevision,
      restoredDraftId: "restored-provider",
      sendOperationId: capture.sendOperationId,
      status: "canceled",
    });
  });

  test("does not invent a receipt when the canonical operation was never admitted", async () => {
    await expect(
      recoverCanceledHeldSend({
        cancel: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ cancelled: true }),
        capture,
        isCurrent: () => true,
        readStatus: vi
          .fn<() => Promise<HeldSendStatus>>()
          .mockResolvedValue(null),
      })
    ).resolves.toBeNull();
  });

  test("does not inspect an operation when no composer was captured", async () => {
    const readStatus = vi.fn<() => Promise<HeldSendStatus>>();
    await expect(
      recoverCanceledHeldSend({
        cancel: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ cancelled: true }),
        capture: null,
        isCurrent: () => true,
        readStatus,
      })
    ).resolves.toBeNull();
    expect(readStatus).not.toHaveBeenCalled();
  });

  test("does not recover across an actor, mailbox, chat or newer-request switch while cancellation waits", async () => {
    const canceled = Promise.withResolvers<unknown>();
    const readStatus = vi.fn<() => Promise<HeldSendStatus>>();
    let current = true;
    const pending = recoverCanceledHeldSend({
      cancel: async () => await canceled.promise,
      capture,
      isCurrent: () => current,
      readStatus,
    });
    current = false;
    canceled.resolve({ cancelled: true });
    await expect(pending).resolves.toBeNull();
    expect(readStatus).not.toHaveBeenCalled();
  });

  test("drops a delayed status result when the captured view is no longer current", async () => {
    const result = Promise.withResolvers<HeldSendStatus>();
    let current = true;
    const pending = recoverCanceledHeldSend({
      cancel: vi
        .fn<() => Promise<unknown>>()
        .mockResolvedValue({ cancelled: true }),
      capture,
      isCurrent: () => current,
      readStatus: async () => await result.promise,
    });
    await Promise.resolve();
    current = false;
    result.resolve(status);
    await expect(pending).resolves.toBeNull();
  });

  test.each(["mailboxId", "sendOperationId"] as const)(
    "rejects a canonical response for another %s",
    async (field) => {
      await expect(
        recoverCanceledHeldSend({
          cancel: vi
            .fn<() => Promise<unknown>>()
            .mockResolvedValue({ cancelled: true }),
          capture,
          isCurrent: () => true,
          readStatus: vi
            .fn<() => Promise<HeldSendStatus>>()
            .mockResolvedValue({ ...status, [field]: "different" }),
        })
      ).resolves.toBeNull();
    }
  );

  test("does not turn cancellation failure into a status lookup or successful recovery", async () => {
    const failure = new Error("cancel failed");
    const readStatus = vi.fn<() => Promise<HeldSendStatus>>();
    await expect(
      recoverCanceledHeldSend({
        cancel: vi.fn<() => Promise<unknown>>().mockRejectedValue(failure),
        capture,
        isCurrent: () => true,
        readStatus,
      })
    ).rejects.toBe(failure);
    expect(readStatus).not.toHaveBeenCalled();
  });

  test("preserves an unexpected lookup failure for the caller's error boundary", async () => {
    const failure = new Error("lookup failed");
    await expect(
      recoverCanceledHeldSend({
        cancel: vi
          .fn<() => Promise<unknown>>()
          .mockResolvedValue({ cancelled: true }),
        capture,
        isCurrent: () => true,
        readStatus: vi
          .fn<() => Promise<HeldSendStatus>>()
          .mockRejectedValue(failure),
      })
    ).rejects.toBe(failure);
  });
});
