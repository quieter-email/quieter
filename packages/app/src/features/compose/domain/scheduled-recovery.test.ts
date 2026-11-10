import type { RouterOutputs } from "@quieter/orpc";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { createEmptyComposeDraft } from "./draft";
import type { ComposeDraftState } from "./draft";
import { recoverComposeSchedule } from "./scheduled-recovery";

type ScheduledMessage = RouterOutputs["scheduledSends"]["create"];
const fixture = vi.hoisted(() => ({
  lookup: vi.fn<() => Promise<ScheduledMessage | null>>(),
  recover:
    vi.fn<
      () => Promise<
        | { status: "abandoned" }
        | { status: "scheduled"; scheduled: ScheduledMessage }
      >
    >(),
  schedule: vi.fn<() => Promise<ScheduledMessage>>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the scheduling RPC methods belong to this test boundary.
vi.mock("@quieter/app/lib/orpc", () => ({
  rpc: {
    scheduledSends: {
      getByOperation: fixture.lookup,
      recoverAttempt: fixture.recover,
    },
  },
}));
vi.mock(import("./draft"), async (importOriginal) => ({
  ...(await importOriginal()),
  scheduleComposeMessage: fixture.schedule,
}));

const scheduled: ScheduledMessage = {
  errorMessage: null,
  id: crypto.randomUUID(),
  mailboxId: "mailbox",
  sendAt: new Date(Date.now() + 86_400_000).toISOString(),
  sendOperationId: crypto.randomUUID(),
  status: "scheduled",
  subject: "A message",
  timeZone: "Europe/Berlin",
  to: "person@example.test",
};

const interruptedDraft = (): ComposeDraftState => ({
  ...createEmptyComposeDraft(),
  recipients: { bcc: "", cc: "", to: "person@example.test" },
  scheduleAttempt: { sendAt: scheduled.sendAt, timeZone: scheduled.timeZone },
  sendOperationId: scheduled.sendOperationId,
  sendUncertain: true,
});

describe("interrupted schedule recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixture.lookup.mockResolvedValue(null);
    fixture.recover.mockResolvedValue({ status: "abandoned" });
    fixture.schedule.mockResolvedValue(scheduled);
  });

  test("does not schedule a recovered message without its missing files", async () => {
    const draft = {
      ...interruptedDraft(),
      recoveryMissingFiles: ["contract.pdf"],
    };
    const result = await recoverComposeSchedule({
      draft,
      mailboxId: "mailbox",
    });
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      draft: { sendUncertain: false },
      status: "editable",
    });
    if (result.status !== "editable") {
      throw new Error("Missing-file recovery did not restore editing.");
    }
    expect(result.draft.errorMessage).toContain("contract.pdf");
    expect(result.draft.sendOperationId).not.toBe(draft.sendOperationId);
  });

  test("unlocks an expired attempt only after the server fences it", async () => {
    const draft = interruptedDraft();
    draft.scheduleAttempt = {
      sendAt: new Date(Date.now() - 86_400_000).toISOString(),
      timeZone: "Europe/Berlin",
    };
    const result = await recoverComposeSchedule({
      draft,
      mailboxId: "mailbox",
    });
    expect(fixture.recover).toHaveBeenCalledWith({
      mailboxId: "mailbox",
      sendOperationId: draft.sendOperationId,
    });
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      draft: { scheduleAttempt: undefined, sendUncertain: false },
      status: "editable",
    });
  });

  test("keeps editing locked when the server cannot fence the missing attempt", async () => {
    const draft = {
      ...interruptedDraft(),
      recoveryMissingFiles: ["contract.pdf"],
    };
    fixture.recover.mockRejectedValue(new Error("Network unavailable"));
    await expect(
      recoverComposeSchedule({ draft, mailboxId: "mailbox" })
    ).rejects.toThrow("Network unavailable");
    expect(fixture.schedule).not.toHaveBeenCalled();
    expect(draft.sendUncertain).toBeTruthy();
  });

  test("finds the complete saved snapshot even when recovered files are missing", async () => {
    fixture.lookup.mockResolvedValue(scheduled);
    const result = await recoverComposeSchedule({
      draft: { ...interruptedDraft(), recoveryMissingFiles: ["contract.pdf"] },
      mailboxId: "mailbox",
    });
    expect(result).toMatchObject({
      scheduled: { id: scheduled.id },
      status: "scheduled",
    });
    expect(fixture.recover).not.toHaveBeenCalled();
    expect(fixture.schedule).not.toHaveBeenCalled();
  });

  test("uses a schedule that wins the race against recovery", async () => {
    fixture.recover.mockResolvedValue({ scheduled, status: "scheduled" });
    const result = await recoverComposeSchedule({
      draft: { ...interruptedDraft(), recoveryMissingFiles: ["contract.pdf"] },
      mailboxId: "mailbox",
    });
    expect(result).toMatchObject({
      scheduled: { id: scheduled.id },
      status: "scheduled",
    });
    expect(fixture.schedule).not.toHaveBeenCalled();
  });
});
