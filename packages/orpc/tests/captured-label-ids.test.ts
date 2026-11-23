/* oxlint-disable vitest/prefer-import-in-mock -- The database client is replaced so the metadata write can be inspected without a server. */
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { writeGmailCapturedMessageMetadata } from "../src/mail-capture";

const dialect = new PgDialect();
const recorded: {
  set?: { snapshot?: SQL };
  where?: SQL;
} = {};

vi.mock("@quieter/database/client", () => ({
  db: {
    transaction: async (run: (tx: unknown) => Promise<void>) => {
      await run({
        update: () => ({
          set: (values: { snapshot?: SQL }) => {
            recorded.set = values;
            return {
              where: (condition: SQL) => {
                recorded.where = condition;
                return {
                  returning: async () => Promise.resolve([]),
                };
              },
            };
          },
        }),
      });
    },
  },
}));

describe("captured message label metadata", () => {
  beforeEach(() => {
    recorded.set = undefined;
    recorded.where = undefined;
  });

  test("binds label ids as one jsonb array when refreshing metadata", async () => {
    const labelIds = ["INBOX", "UNREAD"];
    await writeGmailCapturedMessageMetadata({
      labelIds,
      mailboxId: "mailbox",
      messageId: "message",
      providerRevision: "99",
    });

    const snapshot = recorded.set?.snapshot;
    const { where } = recorded;
    expect(snapshot).toBeDefined();
    expect(where).toBeDefined();
    if (snapshot === undefined || where === undefined) {
      return;
    }

    expect(dialect.sqlToQuery(snapshot).params).toStrictEqual([labelIds, "99"]);
    expect(dialect.sqlToQuery(where).params).toContainEqual(labelIds);
  });
});
