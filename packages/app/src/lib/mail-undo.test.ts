import { createMailUndoController } from "@quieter/app/lib/mail-undo";
import type {
  MailUndoController,
  MailUndoExecution,
  MailUndoScope,
} from "@quieter/app/lib/mail-undo";
import type {
  MailUndoItem,
  MailUndoOffer,
  MailUndoReceiptId,
} from "@quieter/mail/undo";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

const firstId: MailUndoReceiptId =
  "message:00000000-0000-4000-8000-000000000001";
const secondId: MailUndoReceiptId =
  "snooze:00000000-0000-4000-8000-000000000002";
const thirdId: MailUndoReceiptId =
  "placement:00000000-0000-4000-8000-000000000003";
const controllers = new Set<MailUndoController>();
const scope: MailUndoScope = {
  accountId: "account",
  mailboxIds: new Set(["a", "b"]),
  sessionId: "session",
};

const setup = () => {
  const executeUndo = vi.fn<MailUndoExecution>(async ({ input }) => {
    const items = input.receipts.map((receiptId): MailUndoItem => ({
      messageIds: ["message"],
      receiptId,
      replayed: false,
      status: "compensated",
      threadId: "thread",
    }));
    return await Promise.resolve({ items, mailboxId: input.mailboxId });
  });
  const controller = createMailUndoController(executeUndo);
  controllers.add(controller);
  controller.setScope(scope);
  const gesture = controller.beginGesture();
  if (gesture === null) {
    throw new Error("The configured fixture must begin a gesture.");
  }
  const expiresAt = new Date(Date.now() + 60_000).toISOString();
  const a: MailUndoOffer = {
    mailboxId: "a",
    receipts: [{ expiresAt, id: firstId }],
  };
  const b: MailUndoOffer = {
    mailboxId: "b",
    receipts: [{ expiresAt, id: secondId }],
  };
  return { a, b, controller, executeUndo, gesture };
};

describe("scoped mail Undo", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T15:00:00.000Z"));
  });

  afterEach(() => {
    for (const controller of controllers) {
      controller.dispose();
    }
    controllers.clear();
    vi.useRealTimers();
  });

  describe("scoped Undo source execution", () => {
    test("preserves per-message partial outcomes beside a rejected source and does not retry consumed identities", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      const denied = new Error("Permission was removed.", {
        cause: { status: 403 },
      });
      const response = Promise.resolve({
        items: [
          {
            messageIds: ["changed"],
            receiptId: firstId,
            replayed: false,
            status: "compensated",
            threadId: "thread",
          },
          {
            code: "newer_intent",
            message: "A newer action changed this mail.",
            messageIds: ["newer"],
            receiptId: firstId,
            replayed: false,
            status: "changed",
            threadId: "thread",
          },
        ],
        mailboxId: "a",
      });
      executeUndo.mockImplementation(async ({ input }) => {
        if (input.mailboxId === "b") {
          throw denied;
        }
        return await response;
      });
      controller.publishOffer({ gesture, offer: a });
      controller.publishOffer({ gesture, offer: b });
      await controller.execute();
      const snapshot = controller.state.get();
      expect(snapshot).toMatchObject({ kind: "completed" });
      if (snapshot.kind !== "completed") {
        throw new Error("Both source outcomes must be retained.");
      }
      const acknowledged = snapshot.lastCompletion.sources.find(
        (source) => source.kind === "acknowledged"
      );
      if (acknowledged?.kind !== "acknowledged") {
        throw new Error("The acknowledged source must remain available.");
      }
      expect(acknowledged.result).toMatchObject({ mailboxId: "a" });
      expect(acknowledged.result.items).toHaveLength(2);
      expect(acknowledged.result.items).toContainEqual(
        expect.objectContaining({ status: "compensated" })
      );
      expect(acknowledged.result.items).toContainEqual(
        expect.objectContaining({ status: "changed" })
      );
      expect(snapshot.lastCompletion.sources).toContainEqual(
        expect.objectContaining({
          failure: { error: denied, kind: "request" },
          kind: "unconfirmed",
          mailboxId: "b",
          receiptIds: [secondId],
        })
      );
      controller.publishOffer({ gesture, offer: a });
      controller.publishOffer({ gesture, offer: b });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledTimes(2);
      expect(executeUndo.mock.calls.map(([request]) => request)).toContainEqual(
        expect.objectContaining({
          input: { mailboxId: "a", receipts: [firstId] },
          scope: { accountId: "account", sessionId: "session" },
        })
      );
      expect(executeUndo.mock.calls.map(([request]) => request)).toContainEqual(
        expect.objectContaining({
          input: { mailboxId: "b", receipts: [secondId] },
        })
      );
    });

    test("shares the exact pending promise even after expiry and keeps its acknowledged completion", async () => {
      const { a, controller, executeUndo, gesture } = setup();
      const deferred = Promise.withResolvers<unknown>();
      executeUndo.mockReturnValue(deferred.promise);
      controller.publishOffer({ gesture, offer: a });
      const first = controller.execute();
      expect(controller.execute()).toBe(first);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(controller.execute()).toBe(first);
      deferred.resolve({
        items: [
          {
            messageIds: ["message"],
            receiptId: firstId,
            replayed: false,
            status: "compensated",
            threadId: "thread",
          },
        ],
        mailboxId: "a",
      });
      await expect(first).resolves.toBeUndefined();
      expect(controller.state.get()).toMatchObject({
        kind: "completed",
        lastCompletion: { sources: [{ kind: "acknowledged" }] },
      });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledOnce();
    });

    test("retains a late partition during a request and sends it only on the next explicit execute", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      const deferred = Promise.withResolvers<unknown>();
      executeUndo.mockReturnValueOnce(deferred.promise);
      controller.publishOffer({ gesture, offer: a });
      const first = controller.execute();
      controller.publishOffer({ gesture, offer: b });
      expect(controller.execute()).toBe(first);
      deferred.resolve({
        items: [
          {
            messageIds: ["message"],
            receiptId: firstId,
            replayed: false,
            status: "compensated",
            threadId: "thread",
          },
        ],
        mailboxId: "a",
      });
      await first;
      expect(controller.state.get()).toMatchObject({
        eligibleMailboxIds: ["b"],
        kind: "offered",
        lastCompletion: { sources: [{ result: { mailboxId: "a" } }] },
      });
      expect(executeUndo).toHaveBeenCalledOnce();
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledTimes(2);
      expect(
        executeUndo.mock.calls.map(([request]) => request.input)
      ).toContainEqual({ mailboxId: "a", receipts: [firstId] });
      expect(
        executeUndo.mock.calls.map(([request]) => request.input)
      ).toContainEqual({ mailboxId: "b", receipts: [secondId] });
    });

    test("a partition arriving after completion keeps the prior completion identity and never revives a submitted receipt", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      controller.publishOffer({ gesture, offer: a });
      await controller.execute();
      const completed = controller.state.get();
      if (completed.kind !== "completed") {
        throw new Error("The first source must complete.");
      }
      controller.publishOffer({ gesture, offer: b });
      controller.publishOffer({
        gesture,
        offer: {
          ...a,
          receipts: [
            {
              expiresAt: new Date(Date.now() + 120_000).toISOString(),
              id: firstId,
            },
          ],
        },
      });
      const offered = controller.state.get();
      expect(offered).toMatchObject({
        eligibleMailboxIds: ["b"],
        kind: "offered",
      });
      if (offered.kind !== "offered") {
        throw new Error("The late source must remain offered.");
      }
      expect(offered.lastCompletion).toBe(completed.lastCompletion);
      await controller.execute();
      expect(
        executeUndo.mock.calls.filter(
          ([request]) => request.input.mailboxId === "a"
        )
      ).toHaveLength(1);
    });

    test("copies offers and callback request arrays so mutation cannot repoint the protected submission", async () => {
      const { a, controller, executeUndo, gesture } = setup();
      controller.publishOffer({ gesture, offer: a });
      a.mailboxId = "b";
      a.receipts.splice(0, 1, {
        expiresAt: new Date(Date.now() + 500_000).toISOString(),
        id: thirdId,
      });
      const response = Promise.resolve({
        items: [
          {
            messageIds: ["message"],
            receiptId: firstId,
            replayed: false,
            status: "compensated",
            threadId: "thread",
          },
        ],
        mailboxId: "a",
      });
      executeUndo.mockImplementation(async ({ input }) => {
        input.mailboxId = "foreign";
        input.receipts.splice(0, input.receipts.length, thirdId);
        return await response;
      });
      await controller.execute();
      expect(controller.state.get()).toMatchObject({
        kind: "completed",
        lastCompletion: {
          sources: [{ kind: "acknowledged", result: { mailboxId: "a" } }],
        },
      });
    });
  });

  describe("Undo scope and gesture ownership", () => {
    test("same inactive lifecycle calls are idempotent during subscriber cleanup", () => {
      const { controller } = setup();
      let cleared = 0;
      let disposed = 0;
      const subscription = controller.state.subscribe((snapshot) => {
        if (snapshot.kind !== "inactive") {
          return;
        }
        if (snapshot.reason === "unconfigured") {
          cleared += 1;
          if (cleared === 1) {
            controller.setScope(null);
          }
        } else {
          disposed += 1;
          if (disposed === 1) {
            controller.dispose();
          }
        }
      });
      controller.setScope(null);
      controller.setScope(null);
      controller.dispose();
      controller.dispose();
      subscription.unsubscribe();
      expect(cleared).toBe(1);
      expect(disposed).toBe(1);
    });

    test("a newer gesture without an offer fences an older completion and late publication", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      const deferred = Promise.withResolvers<unknown>();
      executeUndo.mockReturnValue(deferred.promise);
      controller.publishOffer({ gesture, offer: a });
      const old = controller.execute();
      const newer = controller.beginGesture();
      await expect(old).resolves.toBeUndefined();
      expect(newer).not.toBe(gesture);
      expect(controller.publishOffer({ gesture, offer: b })).toBe("ignored");
      deferred.reject(new Error("Old private failure."));
      await Promise.resolve();
      await Promise.resolve();
      expect(controller.state.get()).toMatchObject({ kind: "idle" });
      expect(controller.state.get()).not.toHaveProperty("lastCompletion");
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledOnce();
    });

    test.each([
      {
        accountId: "other-account",
        mailboxIds: new Set(["a", "b"]),
        sessionId: "session",
      },
      {
        accountId: "account",
        mailboxIds: new Set(["a", "b"]),
        sessionId: "other-session",
      },
      {
        accountId: "account",
        mailboxIds: new Set(["b"]),
        sessionId: "session",
      },
    ])(
      "fences old work after an effective scope changes away and back",
      async (changed) => {
        const { a, controller, executeUndo, gesture } = setup();
        const deferred = Promise.withResolvers<unknown>();
        executeUndo.mockReturnValue(deferred.promise);
        controller.publishOffer({ gesture, offer: a });
        const old = controller.execute();
        controller.setScope(changed);
        controller.setScope(scope);
        await expect(old).resolves.toBeUndefined();
        expect(controller.publishOffer({ gesture, offer: a })).toBe("ignored");
        deferred.reject(new Error("Old account private failure."));
        await Promise.resolve();
        await Promise.resolve();
        expect(controller.state.get()).toMatchObject({
          kind: "idle",
          scope: { accountId: "account" },
        });
        expect(controller.state.get()).not.toHaveProperty("lastCompletion");
        await controller.execute();
        expect(executeUndo).toHaveBeenCalledOnce();
      }
    );

    test("copies authorization sets and retains an equivalent scope's active gesture", async () => {
      const { a, b, controller, executeUndo } = setup();
      const allowed = new Set(["a"]);
      controller.setScope({ ...scope, mailboxIds: allowed });
      const gesture = controller.beginGesture();
      if (!gesture) {
        throw new Error("The current scope must start a gesture.");
      }
      allowed.delete("a");
      allowed.add("b");
      controller.setScope({ ...scope, mailboxIds: new Set(["a"]) });
      expect(controller.publishOffer({ gesture, offer: b })).toBe("ignored");
      expect(controller.publishOffer({ gesture, offer: a })).toBe("accepted");
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledWith({
        input: { mailboxId: "a", receipts: [firstId] },
        scope: { accountId: "account", sessionId: "session" },
      });
    });

    test("inactive and disposed controllers cannot start work and disposal clears owned timers", async () => {
      const executeUndo = vi.fn<MailUndoExecution>();
      const inactive = createMailUndoController(executeUndo);
      controllers.add(inactive);
      expect(inactive.beginGesture()).toBeNull();
      await inactive.execute();
      const { a, controller, executeUndo: activeExecute, gesture } = setup();
      const deferred = Promise.withResolvers<unknown>();
      activeExecute.mockReturnValue(deferred.promise);
      controller.publishOffer({ gesture, offer: a });
      const pending = controller.execute();
      controller.dispose();
      await expect(pending).resolves.toBeUndefined();
      controller.setScope(scope);
      expect(controller.beginGesture()).toBeNull();
      expect(controller.publishOffer({ gesture, offer: a })).toBe("ignored");
      deferred.resolve({ items: [], mailboxId: "a" });
      await vi.runAllTimersAsync();
      expect(controller.state.get()).toMatchObject({
        kind: "inactive",
        reason: "disposed",
      });
      await controller.execute();
      expect(activeExecute).toHaveBeenCalledOnce();
      expect(executeUndo).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("Undo receipt cutoff and bounded history", () => {
    test("expires receipts independently and a later duplicate cannot extend their first deadline", async () => {
      const { controller, executeUndo, gesture } = setup();
      const start = Date.now();
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "a",
          receipts: [
            { expiresAt: new Date(start + 1000).toISOString(), id: firstId },
          ],
        },
      });
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "b",
          receipts: [
            { expiresAt: new Date(start + 2000).toISOString(), id: secondId },
          ],
        },
      });
      await vi.advanceTimersByTimeAsync(1000);
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "a",
          receipts: [
            { expiresAt: new Date(start + 500_000).toISOString(), id: firstId },
          ],
        },
      });
      expect(controller.state.get()).toMatchObject({
        eligibleMailboxIds: ["b"],
        kind: "offered",
      });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          input: { mailboxId: "b", receipts: [secondId] },
        })
      );
    });

    test("retains already expired identities without offering or resurrecting them", async () => {
      const { controller, executeUndo, gesture } = setup();
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "a",
          receipts: [
            { expiresAt: new Date(Date.now() - 1).toISOString(), id: firstId },
          ],
        },
      });
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "a",
          receipts: [
            {
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
              id: firstId,
            },
          ],
        },
      });
      await controller.execute();
      expect(executeUndo).not.toHaveBeenCalled();
      expect(controller.state.get()).toMatchObject({ kind: "idle" });
    });

    test("keeps pending acknowledgement while an unsubmitted late partition expires", async () => {
      const { a, controller, executeUndo, gesture } = setup();
      const deferred = Promise.withResolvers<unknown>();
      executeUndo.mockReturnValue(deferred.promise);
      controller.publishOffer({ gesture, offer: a });
      const first = controller.execute();
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "b",
          receipts: [
            {
              expiresAt: new Date(Date.now() + 1000).toISOString(),
              id: secondId,
            },
          ],
        },
      });
      await vi.advanceTimersByTimeAsync(2000);
      expect(controller.state.get()).toMatchObject({ kind: "pending" });
      deferred.resolve({
        items: [
          {
            messageIds: ["message"],
            receiptId: firstId,
            replayed: false,
            status: "compensated",
            threadId: "thread",
          },
        ],
        mailboxId: "a",
      });
      await first;
      expect(controller.state.get()).toMatchObject({ kind: "completed" });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledOnce();
    });

    test("bounds retained identities per source atomically without rejecting independently valid mailbox partitions", async () => {
      const { controller, executeUndo, gesture } = setup();
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const ids = Array.from(
        { length: 1000 },
        (_, index): MailUndoReceiptId =>
          `message:10000000-0000-4000-8000-${index.toString().padStart(12, "0")}`
      );
      const receipts = ids.map((id) => ({ expiresAt, id }));
      controller.publishOffer({ gesture, offer: { mailboxId: "a", receipts } });
      controller.publishOffer({ gesture, offer: { mailboxId: "b", receipts } });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledTimes(2);
      expect(
        controller.publishOffer({
          gesture,
          offer: {
            mailboxId: "a",
            receipts: [
              { expiresAt, id: firstId },
              { expiresAt, id: thirdId },
            ],
          },
        })
      ).toBe("limit");
      expect(
        controller.publishOffer({
          gesture,
          offer: {
            mailboxId: "a",
            receipts: [{ expiresAt, id: firstId }],
          },
        })
      ).toBe("limit");
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledTimes(2);
      expect(controller.state.get()).toMatchObject({ kind: "completed" });
    });
  });

  describe("Undo subscriber and callback reentrancy", () => {
    test("a pending subscriber can replace scope before any source launches", async () => {
      const { a, controller, executeUndo, gesture } = setup();
      controller.publishOffer({ gesture, offer: a });
      const subscription = controller.state.subscribe((snapshot) => {
        if (snapshot.kind === "pending") {
          controller.setScope({ ...scope, accountId: "replacement" });
        }
      });
      await controller.execute();
      subscription.unsubscribe();
      expect(executeUndo).not.toHaveBeenCalled();
      expect(controller.state.get()).toMatchObject({
        kind: "idle",
        scope: { accountId: "replacement" },
      });
    });

    test("a synchronous source callback changing scope prevents all remaining old-scope launches", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      controller.publishOffer({ gesture, offer: a });
      controller.publishOffer({ gesture, offer: b });
      const response = Promise.resolve({});
      executeUndo.mockImplementation(async () => {
        controller.setScope(null);
        return await response;
      });
      await controller.execute();
      expect(executeUndo).toHaveBeenCalledOnce();
      expect(controller.state.get()).toMatchObject({ kind: "inactive" });
    });

    test("a completion subscriber can immediately execute a late subset without the prior settlement replacing it", async () => {
      const { a, b, controller, executeUndo, gesture } = setup();
      const first = Promise.withResolvers<unknown>();
      const second = Promise.withResolvers<unknown>();
      executeUndo.mockImplementation(async ({ input }) =>
        input.mailboxId === "a" ? await first.promise : await second.promise
      );
      controller.publishOffer({ gesture, offer: a });
      const firstFlight = controller.execute();
      controller.publishOffer({ gesture, offer: b });
      let secondFlight: Promise<void> | undefined;
      const subscription = controller.state.subscribe((snapshot) => {
        if (snapshot.kind === "offered" && snapshot.lastCompletion !== null) {
          secondFlight = controller.execute();
        }
      });
      first.resolve({
        items: [
          {
            messageIds: [],
            receiptId: firstId,
            replayed: false,
            status: "unchanged",
            threadId: "a-thread",
          },
        ],
        mailboxId: "a",
      });
      await firstFlight;
      expect(controller.state.get()).toMatchObject({ kind: "pending" });
      expect(controller.execute()).toBe(secondFlight);
      second.resolve({
        items: [
          {
            messageIds: [],
            receiptId: secondId,
            replayed: false,
            status: "unchanged",
            threadId: "b-thread",
          },
        ],
        mailboxId: "b",
      });
      await secondFlight;
      subscription.unsubscribe();
      expect(controller.state.get()).toMatchObject({
        kind: "completed",
        lastCompletion: { sources: [{ result: { mailboxId: "b" } }] },
      });
      expect(executeUndo).toHaveBeenCalledTimes(2);
    });

    test("an expiry subscriber can replace scope and install its own timer without stale timer work", async () => {
      const { controller, executeUndo, gesture } = setup();
      controller.publishOffer({
        gesture,
        offer: {
          mailboxId: "a",
          receipts: [
            {
              expiresAt: new Date(Date.now() + 1000).toISOString(),
              id: firstId,
            },
          ],
        },
      });
      const subscription = controller.state.subscribe((snapshot) => {
        if (
          snapshot.kind === "idle" &&
          snapshot.scope.accountId === "account"
        ) {
          controller.setScope({
            ...scope,
            accountId: "replacement",
            mailboxIds: new Set(["b"]),
          });
          const next = controller.beginGesture();
          if (next === null) {
            throw new Error("The replacement scope must begin a gesture.");
          }
          controller.publishOffer({
            gesture: next,
            offer: {
              mailboxId: "b",
              receipts: [
                {
                  expiresAt: new Date(Date.now() + 1000).toISOString(),
                  id: secondId,
                },
              ],
            },
          });
        }
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(controller.state.get()).toMatchObject({
        eligibleMailboxIds: ["b"],
        kind: "offered",
        scope: { accountId: "replacement" },
      });
      await vi.advanceTimersByTimeAsync(1000);
      subscription.unsubscribe();
      expect(controller.state.get()).toMatchObject({
        kind: "idle",
        scope: { accountId: "replacement" },
      });
      await controller.execute();
      expect(executeUndo).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("Undo response association", () => {
    test.each([
      { items: [], mailboxId: "a" },
      {
        items: [
          {
            messageIds: [],
            receiptId: firstId,
            replayed: false,
            status: "unchanged",
            threadId: "private-thread",
          },
        ],
        mailboxId: "foreign",
      },
      {
        items: [
          {
            messageIds: [],
            receiptId: thirdId,
            replayed: false,
            status: "unchanged",
            threadId: "private-thread",
          },
        ],
        mailboxId: "a",
      },
      { items: [{ privateBody: "foreign private payload" }], mailboxId: "a" },
    ])(
      "discards an invalid source payload while preserving a valid neighboring source",
      async (invalid) => {
        const { a, b, controller, executeUndo, gesture } = setup();
        const invalidResult = Promise.resolve(invalid);
        const validResult = Promise.resolve({
          items: [
            {
              messageIds: [],
              receiptId: secondId,
              replayed: false,
              status: "unchanged",
              threadId: "b-thread",
            },
          ],
          mailboxId: "b",
        });
        executeUndo.mockImplementation(
          async ({ input }) =>
            await (input.mailboxId === "a" ? invalidResult : validResult)
        );
        controller.publishOffer({ gesture, offer: a });
        controller.publishOffer({ gesture, offer: b });
        await controller.execute();
        const snapshot = controller.state.get();
        expect(snapshot).toMatchObject({ kind: "completed" });
        if (snapshot.kind !== "completed") {
          throw new Error("The source association must finish independently.");
        }
        expect(snapshot.lastCompletion.sources).toContainEqual(
          expect.objectContaining({
            failure: { kind: "invalid-response" },
            kind: "unconfirmed",
            mailboxId: "a",
            receiptIds: [firstId],
          })
        );
        const acknowledged = snapshot.lastCompletion.sources.find(
          (source) => source.kind === "acknowledged"
        );
        expect(acknowledged).toMatchObject({
          kind: "acknowledged",
          result: { mailboxId: "b" },
        });
        expect(JSON.stringify(snapshot)).not.toContain("private-thread");
        expect(JSON.stringify(snapshot)).not.toContain(
          "foreign private payload"
        );
        await controller.execute();
        expect(executeUndo).toHaveBeenCalledTimes(2);
      }
    );

    test("retains the original current-scope request error for the existing toastError boundary", async () => {
      const { a, controller, executeUndo, gesture } = setup();
      const cause = { code: "FORBIDDEN", status: 403 };
      const error = new Error("The server permission explanation.", { cause });
      executeUndo.mockImplementation(() => {
        throw error;
      });
      controller.publishOffer({ gesture, offer: a });
      await controller.execute();
      const snapshot = controller.state.get();
      if (snapshot.kind !== "completed") {
        throw new Error("The failed source must finish in the current scope.");
      }
      const source = snapshot.lastCompletion.sources.find(
        (outcome) => outcome.kind === "unconfirmed"
      );
      if (source?.kind !== "unconfirmed" || source.failure.kind !== "request") {
        throw new Error("The source must retain a current request failure.");
      }
      expect(source.failure.error).toBe(error);
      expect(executeUndo).toHaveBeenCalledOnce();
    });
  });
});
