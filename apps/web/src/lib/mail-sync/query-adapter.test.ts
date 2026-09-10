import type {
  MessageListItem,
  ThreadMessagesResult,
} from "@quieter/mail/messages";
import { syncMessageSchema } from "@quieter/sync";
import type { SyncChange, SyncCommand } from "@quieter/sync";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vite-plus/test";

import type { MessagesQueryData } from "#/lib/gmail/inbox-query/data";
import { getMessagesQueryKey } from "#/lib/gmail/inbox-query/keys";
import { getThreadQueryKey } from "#/lib/gmail/thread-query-keys";

import { MailSyncQueryAdapter } from "./query-adapter";

const message = syncMessageSchema.parse({
  attachments: [],
  body: { bytes: 10, hash: "a".repeat(64) },
  id: "message",
  internalDate: "1000",
  isUnread: true,
  labelIds: ["INBOX", "UNREAD"],
  threadId: "thread",
});
const projection = (version: string, latest = message): SyncChange[] => [
  {
    data: { kind: "message", value: latest },
    id: latest.id,
    kind: "message",
    version,
  },
  {
    data: {
      kind: "thread",
      value: {
        attachmentCount: 0,
        id: "thread",
        isUnread: latest.isUnread,
        labelIds: latest.labelIds,
        latest,
        messageCount: 1,
        messageIds: [latest.id],
      },
    },
    id: "thread",
    kind: "thread",
    version,
  },
];
const seed = (
  client: QueryClient,
  mailboxId: string,
  messages: MessageListItem[]
) => {
  client.setQueryData<MessagesQueryData>(
    getMessagesQueryKey(mailboxId, "inbox"),
    { pageParams: [undefined], pages: [{ messages }] }
  );
};

describe("mail query adapter", () => {
  test("offers local folder rows and suppresses known deletions in later HTTP reads", () => {
    const adapter = new MailSyncQueryAdapter(new QueryClient());
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(
      adapter.cachedList("a", "inbox")?.messages.map((item) => item.id)
    ).toStrictEqual(["message"]);
    expect(adapter.cachedList("b", "inbox")).toBeUndefined();
    expect(adapter.cachedList("a", "trash")).toBeUndefined();
    adapter.receive({
      entities: [{ data: null, id: "thread", kind: "thread", version: "2" }],
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    const reconcile = adapter.beginListRead("a", "inbox", true, false);
    expect(reconcile({ messages: [message] }).messages).toStrictEqual([]);
  });

  test("rebases delayed search responses over deletions and label changes", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    const reconcile = adapter.beginListRead("a", "inbox", true, true);
    adapter.receive({
      entities: projection("2", { ...message, isUnread: false, labelIds: [] }),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(reconcile({ messages: [message] }).messages).toStrictEqual([]);
    const deleted = adapter.beginListRead("a", "inbox", true, true);
    adapter.receive({
      entities: [{ data: null, id: "thread", kind: "thread", version: "3" }],
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(deleted({ messages: [message] }).messages).toStrictEqual([]);
    adapter.dispose();
    client.clear();
  });

  test("preserves fresh HTTP data when the replica has not changed and fences reset responses", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    const reconcile = adapter.beginListRead("a", "inbox", true, false);
    expect(
      reconcile({ messages: [{ ...message, subject: "Fresh provider data" }] })
        .messages[0].subject
    ).toBe("Fresh provider data");
    adapter.receive({ type: "cache-cleared" });
    expect(() => reconcile({ messages: [message] })).toThrow(
      "Mailbox cache changed"
    );
    adapter.dispose();
    client.clear();
  });

  test("keeps other unread messages and inbox membership when one message is changed", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    seed(client, "a", [message]);
    const second = { ...message, id: "second", internalDate: "2000" };
    const entities = projection("1", second);
    for (const entity of entities) {
      if (entity.data?.kind === "thread") {
        entity.data.value.messageIds = [message.id, second.id];
        entity.data.value.messageCount = 2;
      }
    }
    entities.push({
      data: { kind: "message", value: message },
      id: message.id,
      kind: "message",
      version: "1",
    });
    adapter.receive({
      entities,
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    adapter.addCommand({
      command: { kind: "set-read", read: true },
      commandId: crypto.randomUUID(),
      mailboxId: "a",
      targets: [{ messageIds: [second.id], threadId: "thread" }],
    });
    adapter.addCommand({
      command: { destination: "archive", kind: "move" },
      commandId: crypto.randomUUID(),
      mailboxId: "a",
      targets: [{ messageIds: [second.id], threadId: "thread" }],
    });
    const inbox = client.getQueryData<MessagesQueryData>(
      getMessagesQueryKey("a", "inbox")
    )?.pages[0].messages;
    expect(inbox).toHaveLength(1);
    expect(inbox?.[0]).toMatchObject({
      id: message.id,
      isUnread: true,
      threadMessageCount: 2,
    });
    adapter.dispose();
    client.clear();
  });

  test("accepts lower entity versions after a stream reset", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    seed(client, "a", [message]);
    adapter.receive({
      entities: projection("90"),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    adapter.receive({
      entities: projection("1", { ...message, subject: "New stream" }),
      mailboxId: "a",
      replace: true,
      reset: true,
      type: "entities",
    });
    expect(
      client.getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages[0].subject
    ).toBe("New stream");
    adapter.dispose();
    client.clear();
  });

  test("replaces a thread anchor without duplicating rows and isolates identical provider IDs", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    seed(client, "a", [message]);
    seed(client, "b", [message]);
    adapter.receive({
      entities: projection("2", {
        ...message,
        id: "new-message",
        internalDate: "2000",
      }),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(
      client
        .getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages.map((item) => item.id)
    ).toStrictEqual(["new-message"]);
    expect(
      client
        .getQueryData<MessagesQueryData>(getMessagesQueryKey("b", "inbox"))
        ?.pages[0].messages.map((item) => item.id)
    ).toStrictEqual(["message"]);
    adapter.dispose();
    client.clear();
  });

  test("keeps a pending archive through unrelated provider updates and restores the base on rejection", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    seed(client, "a", [message]);
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: true,
      type: "entities",
    });
    const command: SyncCommand = {
      command: { destination: "archive", kind: "move" },
      commandId: crypto.randomUUID(),
      mailboxId: "a",
      targets: [{ messageIds: [message.id], threadId: "thread" }],
    };
    adapter.addCommand(command);
    expect(
      client.getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages
    ).toStrictEqual([]);
    adapter.receive({
      entities: projection("2", { ...message, subject: "Updated" }),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(
      client.getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages
    ).toStrictEqual([]);
    adapter.rejectCommand(command);
    expect(
      client.getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages[0].subject
    ).toBe("Updated");
    adapter.dispose();
    client.clear();
  });

  test("preserves warmed bodies on repeated ranges but removes content with a changed body hash", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: true,
      type: "entities",
    });
    adapter.receive({
      mailboxId: "a",
      thread: {
        messages: [{ ...message, bodyText: "Cached content" }],
        threadId: "thread",
      },
      type: "thread",
    });
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: true,
      type: "entities",
    });
    expect(
      client.getQueryData<ThreadMessagesResult>(
        getThreadQueryKey("a", "thread")
      )?.messages[0].bodyText
    ).toBe("Cached content");
    adapter.receive({
      entities: projection("2", {
        ...message,
        body: { bytes: 20, hash: "b".repeat(64) },
      }),
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(
      client.getQueryData<ThreadMessagesResult>(
        getThreadQueryKey("a", "thread")
      )?.messages[0].bodyText
    ).toBeUndefined();
    adapter.dispose();
    client.clear();
  });

  test("tombstones remove a row and its detail and revocation clears all mailbox queries", () => {
    const client = new QueryClient();
    const adapter = new MailSyncQueryAdapter(client);
    seed(client, "a", [message]);
    adapter.receive({
      entities: projection("1"),
      mailboxId: "a",
      replace: true,
      type: "entities",
    });
    adapter.receive({
      entities: [{ data: null, id: "thread", kind: "thread", version: "2" }],
      mailboxId: "a",
      replace: false,
      type: "entities",
    });
    expect(
      client.getQueryData<MessagesQueryData>(getMessagesQueryKey("a", "inbox"))
        ?.pages[0].messages
    ).toStrictEqual([]);
    expect(
      client.getQueryData<ThreadMessagesResult>(
        getThreadQueryKey("a", "thread")
      )?.messages
    ).toStrictEqual([]);
    adapter.receive({ mailboxId: "a", type: "revoked" });
    expect(
      client.getQueriesData({ queryKey: ["messages", "a"] })
    ).toStrictEqual([]);
    adapter.dispose();
    client.clear();
  });
});
