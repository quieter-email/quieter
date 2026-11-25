import type { MessageListItem } from "@quieter/mail/messages";
import type { MailSnoozeState } from "@quieter/mail/snooze";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { attachMailSnoozeStates } from "../src/snooze/queries";
import type {
  getMailSnoozeStateEntries,
  reconcileMailSnoozeSource,
} from "../src/snooze/state";

const mocks = vi.hoisted(() => ({
  getMailSnoozeStateEntries: vi.fn<typeof getMailSnoozeStateEntries>(),
  reconcileMailSnoozeSource: vi.fn<typeof reconcileMailSnoozeSource>(),
}));

vi.mock(import("../src/snooze/state"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getMailSnoozeStateEntries: mocks.getMailSnoozeStateEntries,
    reconcileMailSnoozeSource: mocks.reconcileMailSnoozeSource,
  };
});

describe("attachMailSnoozeStates lock-avoidance behavior", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("skips FOR UPDATE reconciliation when inbox messages are already in knownIncomingMessageIds", async () => {
    const activeState: MailSnoozeState = {
      id: "00000000-0000-4000-8000-000000000001",
      mailboxId: "mbx-1",
      returnAt: new Date(Date.now() + 60_000).toISOString(),
      status: "active",
      threadId: "thread-1",
      timeZone: "Etc/UTC",
      version: 2,
    };
    mocks.getMailSnoozeStateEntries.mockResolvedValue(
      new Map([
        [
          "thread-1",
          {
            knownIncomingMessageIds: ["msg-known"],
            state: activeState,
          },
        ],
      ])
    );

    const messages: MessageListItem[] = [
      {
        id: "msg-known",
        labelIds: ["INBOX"],
        threadId: "thread-1",
        threadInboxIncomingMessageIds: ["msg-known"],
      },
    ];

    const attached = await attachMailSnoozeStates({
      mailboxId: "mbx-1",
      messages,
      userId: "user-1",
    });

    expect(mocks.reconcileMailSnoozeSource).not.toHaveBeenCalled();
    expect(attached[0]?.snooze).toMatchObject({ status: "active", version: 2 });
  });

  test("reconciles only when an unseen incoming inbox message arrives", async () => {
    const activeState: MailSnoozeState = {
      id: "00000000-0000-4000-8000-000000000002",
      mailboxId: "mbx-1",
      returnAt: new Date(Date.now() + 60_000).toISOString(),
      status: "active",
      threadId: "thread-2",
      timeZone: "Etc/UTC",
      version: 2,
    };
    mocks.getMailSnoozeStateEntries.mockResolvedValue(
      new Map([
        [
          "thread-2",
          {
            knownIncomingMessageIds: ["msg-known"],
            state: activeState,
          },
        ],
      ])
    );
    mocks.reconcileMailSnoozeSource.mockResolvedValue({
      ...activeState,
      status: "superseded",
      version: 3,
    });

    const attached = await attachMailSnoozeStates({
      mailboxId: "mbx-1",
      messages: [
        {
          id: "msg-reply",
          labelIds: ["INBOX"],
          threadId: "thread-2",
          threadInboxIncomingMessageIds: ["msg-known", "msg-reply"],
        },
      ],
      userId: "user-1",
    });

    expect(mocks.reconcileMailSnoozeSource).toHaveBeenCalledOnce();
    expect(attached[0]?.snooze).toMatchObject({
      status: "superseded",
      version: 3,
    });
  });
});
