/* oxlint-disable eslint/max-classes-per-file -- Constructor doubles for the Worker and query adapter stay beside their lifecycle tests. */
import type { SyncCommand } from "@quieter/sync";
import type { SyncReceipt } from "@quieter/sync-client/types";
import { QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import { MailSyncSession } from "./session";

const fixture = vi.hoisted(() => ({
  action: vi.fn<(input: unknown) => Promise<unknown>>(),
  addCommand: vi.fn<(input: SyncCommand) => void>(),
  command: vi.fn<(input: SyncCommand) => Promise<SyncReceipt>>(),
  rejectCommand: vi.fn<(input: SyncCommand) => void>(),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Control worker completion while exercising the real session lifecycle.
vi.mock("@quieter/sync-client/worker-client", () => ({
  MailSyncWorkerClient: class {
    ready = Promise.resolve();
    action = fixture.action;
    command = fixture.command;
    stop = fixture.action;
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- IndexedDB is covered by the journal integration suite.
vi.mock("@quieter/sync-client/draft-journal", () => ({
  DraftJournal: {
    open: async () => {
      await Promise.resolve();
      return null;
    },
  },
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Record optimistic overlays independently of the query adapter's dedicated reconciliation tests.
vi.mock("./query-adapter", () => ({
  MailSyncQueryAdapter: class {
    addCommand = fixture.addCommand;
    rejectCommand = fixture.rejectCommand;
    setMailboxes = vi.fn<() => void>();
    dispose = vi.fn<() => void>();
  },
}));

describe("mail sync session", () => {
  let session: MailSyncSession | null = null;
  beforeEach(() => {
    vi.resetAllMocks();
    // oxlint-disable-next-line typescript/no-extraneous-class -- The real session constructs a Worker; its client is replaced above.
    vi.stubGlobal("Worker", class {});
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    vi.stubGlobal("navigator", { onLine: true });
  });
  afterEach(async () => {
    await session?.stop(false);
    session = null;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("serves an authorized mailbox while other replicas are still loading", async () => {
    const loaded = Promise.withResolvers<null>();
    fixture.action.mockReturnValueOnce(loaded.promise);
    const waiting = MailSyncSession.waitForMailbox("mailbox");
    session = MailSyncSession.start("user", new QueryClient());
    const subscribing = session.subscribe([
      { id: "mailbox", provider: "gmail" },
    ]);
    await expect(waiting).resolves.toBe(session);
    expect(MailSyncSession.forMailbox("other")).toBeNull();
    loaded.resolve(null);
    await subscribing;
  });

  test("cancels waiting reads on abort and account change", async () => {
    session = MailSyncSession.start("user", new QueryClient());
    const controller = new AbortController();
    const aborted = MailSyncSession.waitForMailbox(
      "mailbox",
      controller.signal
    );
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: "AbortError" });
    const stopped = MailSyncSession.waitForMailbox("mailbox");
    await session.stop(false);
    await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
    session = null;
  });

  test("times out unavailable startup instead of using a second mutation path", async () => {
    vi.useFakeTimers();
    const waiting = MailSyncSession.waitForMailbox("mailbox");
    const outcome = (async () => {
      await expect(waiting).rejects.toThrow("synchronization is unavailable");
    })();
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
  });

  test("overlays repeated actions immediately, submits in order, and continues after failure", async () => {
    session = MailSyncSession.start("user", new QueryClient());
    const pending = Promise.withResolvers<SyncReceipt>();
    fixture.command.mockReturnValueOnce(pending.promise);
    fixture.command.mockImplementationOnce(async (input) => {
      await Promise.resolve();
      return { commandId: input.commandId, error: null, status: "accepted" };
    });
    const targets = [{ messageIds: ["message"], threadId: "thread" }];
    const first = session.command("mailbox", targets, {
      kind: "set-read",
      read: true,
    });
    const failed = (async () => {
      await expect(first).rejects.toThrow("Request failed");
    })();
    const second = session.command("mailbox", targets, {
      kind: "set-read",
      read: false,
    });
    expect(fixture.addCommand).toHaveBeenCalledTimes(2);
    await vi.waitFor(() => {
      expect(fixture.command).toHaveBeenCalledOnce();
    });
    pending.reject(new Error("Request failed"));
    await failed;
    await second;
    expect(fixture.command).toHaveBeenCalledTimes(2);
    expect(fixture.rejectCommand).toHaveBeenCalledOnce();
    expect(fixture.command.mock.calls[1]?.[0].command).toStrictEqual({
      kind: "set-read",
      read: false,
    });
  });
});
