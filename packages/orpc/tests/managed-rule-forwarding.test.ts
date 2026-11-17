import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import type { readRawMailObject } from "../src/managed-mail/messages/raw-object";
import type { sendManagedMailboxMessage } from "../src/managed-mail/messages/send";
import { applyManagedRulesToMessage } from "../src/managed-mail/rules/evaluator";
import { managedRuleSnapshotSchema } from "../src/managed-mail/rules/snapshot";

type Row = Record<string, unknown>;

const fixtures = vi.hoisted(() => ({
  message: {},
  raw: vi.fn<typeof readRawMailObject>(),
  send: vi.fn<typeof sendManagedMailboxMessage>(),
  tables: new Map<string, Row[]>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Only the evaluator's single-message persistence methods are modeled.
vi.mock("@quieter/database/client", async () => {
  const { getTableName } = await import("drizzle-orm");
  const database = {
    insert: (table: Parameters<typeof getTableName>[0]) => ({
      values: (value: Row) => ({
        returning: () => {
          const row = { error: null, ...value };
          fixtures.tables.get(getTableName(table))?.push(row);
          return [row];
        },
      }),
    }),
    select: () => ({
      from: (table: Parameters<typeof getTableName>[0]) => {
        const rows = fixtures.tables.get(getTableName(table)) ?? [];
        const query = {
          for: () => query,
          innerJoin: () => query,
          limit: () => rows,
          orderBy: () => query,
          // oxlint-disable-next-line unicorn/no-thenable -- Drizzle queries can be awaited without a limit.
          then: async (onFulfilled?: (values: Row[]) => unknown) =>
            await onFulfilled?.(rows),
          where: () => query,
        };
        return query;
      },
    }),
    update: (table: Parameters<typeof getTableName>[0]) => ({
      set: (values: Row) => ({
        where: () => {
          for (const row of fixtures.tables.get(getTableName(table)) ?? []) {
            Object.assign(row, values);
          }
        },
      }),
    }),
  };
  return {
    db: {
      ...database,
      transaction: async <Result>(
        run: (transaction: typeof database) => Promise<Result>
      ): Promise<Result> => await run(database),
    },
  };
});
vi.mock(import("../src/managed-mail/messages/send"), () => ({
  sendManagedMailboxMessage: fixtures.send,
}));
vi.mock(import("../src/managed-mail/messages/raw-object"), () => ({
  readRawMailObject: fixtures.raw,
}));

const snapshot = managedRuleSnapshotSchema.parse({
  actions: [
    {
      includeAttachments: false,
      kind: "forward",
      recipients: ["archive@example.test"],
    },
    { destination: "spam", kind: "move" },
  ],
  enabled: true,
  id: "rule-forward-and-filter",
  matchMode: "all",
  name: "Archive and filter incoming notices",
  ownerUserId: "rule-owner",
  revision: "revision-1",
  search: { filters: [], text: "notice" },
});

describe("automatic rule forwarding", () => {
  beforeEach(() => {
    fixtures.send.mockReset();
    fixtures.raw.mockReset();
    Object.assign(fixtures.message, {
      bodyHtml: "<p>An ordinary notice</p>",
      bodyText: "An ordinary notice",
      direction: "inbound",
      from: "Sender <sender@example.test>",
      headers: [],
      id: "incoming-message",
      mailboxId: "managed-mailbox",
      mailboxState: "active",
      searchText: "notice",
      snippet: "An ordinary notice",
      subject: "Notice",
    });
    fixtures.tables.clear();
    fixtures.tables.set("managedMailMessage", [fixtures.message]);
    fixtures.tables.set("managedMailRule", [{ enabled: true }]);
    fixtures.tables.set("managedMailRuleRun", []);
    fixtures.tables.set("managedMailRuleApplication", []);
    fixtures.tables.set("managedMailAttachment", []);
    fixtures.tables.set("managedMailMessageLabel", []);
  });

  test.each([
    {
      forwarded: {
        bodyHtml: "An ordinary notice",
        bodyText: "An ordinary notice",
      },
      incoming: {},
      name: "ordinary content",
    },
    {
      forwarded: { bodyHtml: "An ordinary notice", bodyText: "{{?project}}" },
      incoming: { bodyText: "Notice {{?project}}" },
      name: "a literal field in plain text",
    },
    {
      forwarded: {
        bodyHtml: "&#123;&#123;?<strong>project</strong>&#125;&#125;",
        bodyText: "An ordinary notice",
      },
      incoming: {
        bodyHtml:
          "<p>Notice &#123;&#123;?<strong>project</strong>&#125;&#125;</p>",
        bodyText: null,
      },
      name: "an encoded field split across HTML nodes",
    },
    {
      forwarded: {
        bodyHtml: "{{@recipient.name}}",
        bodyText: "{{@recipient.name}}",
      },
      incoming: { subject: "Notice {{@recipient.name}}" },
      name: "a context marker in the received subject",
    },
    {
      forwarded: { bodyHtml: "{{?sender}}", bodyText: "{{?sender}}" },
      incoming: { from: '"{{?sender}}" <sender@example.test>' },
      name: "a field in the received sender name",
    },
    {
      forwarded: { bodyHtml: "An ordinary notice", bodyText: "{{?fallback}}" },
      incoming: { bodyText: null, snippet: "Notice {{?fallback}}" },
      name: "a field in the text fallback",
    },
  ])(
    "forwards $name and completes the following filter action",
    async ({ forwarded, incoming }) => {
      Object.assign(fixtures.message, incoming);

      await expect(
        applyManagedRulesToMessage({
          mailboxId: "managed-mailbox",
          messageId: "incoming-message",
          snapshot,
        })
      ).resolves.toMatchObject({ error: null, matched: true });

      expect(fixtures.send).toHaveBeenCalledOnce();
      expect(fixtures.send.mock.calls[0]?.[0]).toMatchObject({
        mailboxId: "managed-mailbox",
        message: {
          headers: [{ name: "X-Quieter-Rule-Forwarded", value: snapshot.id }],
          recipients: { to: "archive@example.test" },
        },
        userId: "rule-owner",
      });
      expect(fixtures.send.mock.calls[0]?.[0].message.bodyHtml).toContain(
        forwarded.bodyHtml
      );
      expect(fixtures.send.mock.calls[0]?.[0].message.bodyText).toContain(
        forwarded.bodyText
      );
      expect(fixtures.message).toMatchObject({ mailboxState: "spam" });
      expect(
        fixtures.tables.get("managedMailRuleRun")?.[0]?.completedAt
      ).toBeInstanceOf(Date);
      expect(fixtures.tables.get("managedMailRuleRun")?.[0]).toMatchObject({
        error: null,
      });
    }
  );
});
