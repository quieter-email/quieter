import { getMailboxCapabilities } from "@quieter/mail/data-plane";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { assertAccessibleMailbox } from "../src/mailbox/service";
import {
  indexSemanticSources,
  prepareSemanticSearch,
  readSemanticSearchCoverage,
} from "../src/semantic-search";

const fixture = vi.hoisted(() => ({
  query: vi.fn<(...args: unknown[]) => Promise<{ rows: unknown[][] }>>(),
}));
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: vi.fn<typeof assertAccessibleMailbox>(),
}));
vi.mock(import("@quieter/database/client"), async (original) => {
  const actual = await original();
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const database = drizzle(fixture.query);
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, property) {
        if (property === "execute") {
          return database.execute.bind(database);
        }
        throw new Error(
          "Unexpected database operation in semantic boundary proof."
        );
      },
    }),
  };
});

const scope = { mailboxId: "private-outlook", userId: "acting-owner" };

describe("closed Outlook semantic mail boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertAccessibleMailbox).mockResolvedValue({
      capabilities: getMailboxCapabilities({ provider: "outlook" }),
      contentRevision: 1,
      id: scope.mailboxId,
      organizationId: "organization",
      provider: "outlook",
    });
    fixture.query.mockResolvedValue({ rows: [] });
  });

  test("mail coverage, preparation and indexing fail before source SQL or a lease", async () => {
    const input = { ...scope, kind: "mail" as const };
    for (const operation of [
      async () => await readSemanticSearchCoverage(input),
      async () =>
        await prepareSemanticSearch({ ...input, query: "private content" }),
      async () => await indexSemanticSources(input),
    ]) {
      await expect(operation()).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(fixture.query).not.toHaveBeenCalled();
  });

  test.each(["memory", "chat"] as const)(
    "%s still queries the acting user's established source",
    async (kind) => {
      await expect(
        readSemanticSearchCoverage({ ...scope, kind })
      ).resolves.toMatchObject({
        complete: true,
        totalSources: 0,
      });
      const [query, parameters] = fixture.query.mock.calls[0] ?? [];
      expect(query).toStrictEqual(
        expect.stringContaining(
          kind === "memory" ? 'from "aiMemory"' : 'from "chatMessage"'
        )
      );
      expect(parameters).toStrictEqual(
        expect.arrayContaining([scope.userId, scope.mailboxId])
      );
      expect(query).not.toMatch(
        /gmailCapturedMessage|managedMailMessage|semanticSearchLease/u
      );
    }
  );
});
