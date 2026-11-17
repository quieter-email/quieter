import { buildThreadListEntries } from "@quieter/app/lib/gmail/thread-list";
import { isMessageInMailbox } from "@quieter/app/lib/mail";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { describe, expect, it } from "vite-plus/test";

import { createDemoActions, reconcileDemoSnoozes } from "./actions";
import type { DemoSnoozeSchedule, DemoSnoozeStore } from "./actions";
import { listDemoMail } from "./queries";

const setup = () => {
  let state: {
    messages: MessageListItem[];
    snoozes: Partial<Record<string, DemoSnoozeSchedule>>;
  } = {
    messages: [
      {
        attachments: [
          {
            attachmentId: "attachment",
            fileName: "notes.pdf",
            mimeType: "application/pdf",
            size: 20,
          },
        ],
        bodyText: "Full message",
        id: "hidden",
        labelIds: ["INBOX"],
        threadId: "thread",
      },
      { id: "archived", labelIds: [], threadId: "thread" },
      { id: "sent", labelIds: ["SENT"], threadId: "thread" },
    ],
    snoozes: {},
  };
  const store: DemoSnoozeStore = {
    mailboxId: "demo-test",
    updateMessages: (update) => {
      state = reconcileDemoSnoozes({
        ...state,
        messages: update(state.messages),
      });
    },
    updateSnoozes: (update) => {
      state = update(state);
    },
  };
  return {
    actions: createDemoActions(store, async () => {
      await Promise.resolve();
    }),
    read: () => state,
    store,
  };
};

const schedule = {
  kind: "snooze",
  returnAt: new Date(Date.now() + 86_400_000).toISOString(),
  timeZone: "America/New_York",
} as const;

describe("demo Snooze source behavior", () => {
  it("reschedules and returns only the saved Inbox messages while preserving loaded content", async () => {
    const { actions, read } = setup();
    await actions.applyThreadSnooze("thread", schedule);
    expect(
      read().messages.every(
        (message) => message.labelIds?.includes("INBOX") !== true
      )
    ).toBeTruthy();
    expect(isMessageInMailbox(read().messages[0], "later")).toBeTruthy();
    await actions.applyThreadSnooze("thread", {
      ...schedule,
      kind: "reschedule",
      returnAt: new Date(Date.now() + 172_800_000).toISOString(),
    });
    await actions.applyThreadSnooze("thread", { kind: "return-now" });
    expect(
      read()
        .messages.filter(
          (message) => message.labelIds?.includes("INBOX") === true
        )
        .map((message) => message.id)
    ).toStrictEqual(["hidden"]);
    expect(read().messages[0]).toMatchObject({
      attachments: [{ fileName: "notes.pdf" }],
      bodyText: "Full message",
      snooze: { status: "returned" },
    });
    await expect(
      actions.applyThreadSnooze("thread", { kind: "return-now" })
    ).rejects.toThrow(/changed/u);
  });

  it("keeps hidden mail in Done when the return is cancelled", async () => {
    const { actions, read } = setup();
    const input = { historyId: "demo", labels: [] };
    await actions.applyThreadSnooze("thread", schedule);
    expect(
      listDemoMail(read().messages, { ...input, category: "done" }).messages
    ).toHaveLength(0);
    expect(
      listDemoMail(read().messages, {
        ...input,
        category: "later",
      }).messages.map((message) => message.id)
    ).toContain("hidden");
    await actions.applyThreadSnooze("thread", { kind: "cancel" });
    expect(isMessageInMailbox(read().messages[0], "done")).toBeTruthy();
    expect(isMessageInMailbox(read().messages[0], "later")).toBeFalsy();
    expect(
      listDemoMail(read().messages, {
        ...input,
        category: "done",
      }).messages.map((message) => message.id)
    ).toContain("hidden");
    expect(
      listDemoMail(read().messages, { ...input, category: "later" }).messages
    ).toHaveLength(0);
    await expect(
      actions.applyThreadSnooze("thread", {
        kind: "reschedule",
        returnAt: schedule.returnAt,
        timeZone: schedule.timeZone,
      })
    ).rejects.toThrow(/changed/u);
  });

  it("rejects an action from an older source version", async () => {
    const { actions, read } = setup();
    await actions.applyThreadSnooze("thread", schedule);
    const stale = buildThreadListEntries(read().messages);
    await actions.applyThreadSnooze("thread", {
      ...schedule,
      kind: "reschedule",
    });
    await expect(
      actions.applyThreadsSnooze(stale, { kind: "cancel" })
    ).rejects.toThrow(/changed/u);
    expect(read().snoozes.thread?.state.status).toBe("active");
    await expect(
      actions.applyThreadSnooze(
        "thread",
        { kind: "cancel" },
        stale[0].anchorMessage.snooze?.version ?? null
      )
    ).rejects.toThrow(/changed/u);
  });

  it("ends a return once when a new incoming reply reopens the thread", async () => {
    const { actions, read, store } = setup();
    await actions.applyThreadSnooze("thread", schedule);
    store.updateMessages((messages) => [
      ...messages,
      { id: "reply", labelIds: ["INBOX"], threadId: "thread" },
    ]);
    const previousVersion = read().snoozes.thread?.state.version;
    expect(read().snoozes.thread?.state.status).toBe("superseded");
    expect(
      read()
        .messages.filter(
          (message) => message.labelIds?.includes("INBOX") === true
        )
        .map((message) => message.id)
    ).toStrictEqual(["reply"]);
    store.updateMessages((messages) =>
      messages.map((message) => ({ ...message, isUnread: false }))
    );
    expect(read().snoozes.thread?.state.version).toBe(previousVersion);
  });
});
