/* oxlint-disable eslint/require-await -- Database transport doubles preserve asynchronous contracts without network I/O. */
import { ORPCError } from "@orpc/server";
import type { AiMemoryMetadata } from "@quieter/database/schema";
import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import { loadAiAgentContext } from "../src/ai-memory-context";
import type { assertAccessibleMailbox } from "../src/mailbox/service";
import type { requestSemanticIndex } from "../src/semantic-index-request";
import type { prepareSemanticSearch } from "../src/semantic-search";

const fixtures = vi.hoisted(() => ({
  access: vi.fn<typeof assertAccessibleMailbox>(),
  index: vi.fn<typeof requestSemanticIndex>(),
  query:
    vi.fn<
      (query: string, parameters: unknown[]) => Promise<{ rows: unknown[][] }>
    >(),
  semantic: vi.fn<typeof prepareSemanticSearch>(),
}));

// oxlint-disable-next-line vitest/prefer-import-in-mock -- Exercise Drizzle's actual parameterized PostgreSQL queries at the transport boundary.
vi.mock("@quieter/database/client", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  return { db: drizzle(fixtures.query) };
});
vi.mock(import("../src/mailbox/service"), () => ({
  assertAccessibleMailbox: fixtures.access,
}));
vi.mock(import("../src/semantic-index-request"), () => ({
  requestSemanticIndex: fixtures.index,
}));
vi.mock(import("../src/semantic-search"), () => ({
  prepareSemanticSearch: fixtures.semantic,
}));

const selected = {
  mailboxId: "selected-mailbox",
  overview: { correspondentEmail: "Alex+Tag@example.test" },
  userId: "reader",
};
const memoryRow = ({
  content = "Use short greetings with Alex.",
  id = "memory-001",
  metadata = { correspondents: ["alex+tag@example.test"] },
  summary = "Greeting preference",
}: {
  content?: string;
  id?: string;
  metadata?: AiMemoryMetadata;
  summary?: string;
} = {}): unknown[] => [
  0.9,
  content,
  new Date("2026-11-01T12:00:00Z"),
  null,
  id,
  "learned",
  new Date("2026-11-01T12:00:00Z"),
  metadata,
  2,
  "explicit",
  summary,
  new Date("2026-11-02T12:00:00Z"),
  3,
];

const expectBoundEquality = ({
  parameters,
  pattern,
  query,
  value,
}: {
  parameters: unknown[];
  pattern: RegExp;
  query: string;
  value: string;
}) => {
  const parameter = query.match(pattern)?.groups?.parameter;
  expect(parameter).toBeDefined();
  expect(parameters[Number(parameter) - 1]).toBe(value);
};

describe("correspondent memory overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.access.mockReset();
    fixtures.query.mockReset().mockImplementation(async (query) => ({
      rows: query.startsWith("select count(") ? [[1]] : [memoryRow()],
    }));
  });

  test.each([
    "",
    "  ",
    "alex",
    "Alex <alex@example.test>",
    "alex@example.test' or true",
  ])(
    "rejects an invalid correspondent before reading data (%s)",
    async (correspondentEmail) => {
      await expect(
        loadAiAgentContext({
          ...selected,
          overview: { correspondentEmail },
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixtures.query).not.toHaveBeenCalled();
      expect(fixtures.access).not.toHaveBeenCalled();
    }
  );

  test.each(["", " \t "])(
    "requires a nonempty mailbox before reading selected memories (%s)",
    async (mailboxId) => {
      await expect(
        loadAiAgentContext({ ...selected, mailboxId })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(fixtures.query).not.toHaveBeenCalled();
    }
  );

  test("rejects an untyped correspondent request without a mailbox", async () => {
    const input = { overview: selected.overview, userId: selected.userId };
    const result: unknown = Reflect.apply(loadAiAgentContext, undefined, [
      input,
    ]);
    await expect(result).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(fixtures.query).not.toHaveBeenCalled();
  });

  test("denies an inaccessible selected mailbox before querying memory", async () => {
    fixtures.access.mockRejectedValueOnce(new ORPCError("NOT_FOUND"));
    await expect(loadAiAgentContext(selected)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(fixtures.query).not.toHaveBeenCalled();
  });

  test("binds owner, lifecycle, mailbox and exact normalized array membership in both data and count queries", async () => {
    await loadAiAgentContext({
      ...selected,
      overview: { correspondentEmail: " \tAlex+Tag@EXAMPLE.TEST\u00A0" },
    });
    expect(fixtures.query).toHaveBeenCalledWith();
    for (const [query, parameters] of fixtures.query.mock.calls) {
      expect(query).toMatch(
        /where \(*"aiMemory"\."scope" = \$\d+\)* and \(*"aiMemory"\."scopeKey" = \$\d+\)* and \(*"aiMemory"\."userId" = \$\d+\)* and \(*"aiMemory"\."status" = \$\d+\)* and \(*"aiMemory"\."expiresAt" is null\)* or \(*"aiMemory"\."expiresAt" > \$\d+\)/u
      );
      expect(query).toMatch(
        /\("aiMemory"\."metadata"->>'sourceMailboxId' is null\)* or \(*"aiMemory"\."metadata"->>'sourceMailboxId' = \$\d+\)/u
      );
      expect(query).toContain("jsonb_array_elements_text(");
      expect(query).toContain("jsonb_typeof(");
      expect(query).not.toMatch(/ilike|Alex|example\.test/u);
      for (const [pattern, value] of [
        [/"aiMemory"\."scope" = \$(?<parameter>\d+)/u, "user"],
        [/"aiMemory"\."scopeKey" = \$(?<parameter>\d+)/u, "user:reader"],
        [/"aiMemory"\."userId" = \$(?<parameter>\d+)/u, "reader"],
        [/"aiMemory"\."status" = \$(?<parameter>\d+)/u, "active"],
        [
          /"aiMemory"\."metadata"->>'sourceMailboxId' = \$(?<parameter>\d+)/u,
          "selected-mailbox",
        ],
        [
          /lower\(btrim\(correspondent\.email, \$\d+\)\) = \$(?<parameter>\d+)/u,
          "alex+tag@example.test",
        ],
      ] satisfies [RegExp, string][]) {
        expectBoundEquality({ parameters, pattern, query, value });
      }
    }
    expect(fixtures.index).not.toHaveBeenCalled();
    expect(fixtures.semantic).not.toHaveBeenCalled();
  });

  test("redacts secrets and normalizes historical correspondent metadata for the editor", async () => {
    fixtures.query.mockImplementation(async (query) => ({
      rows: query.startsWith("select count(")
        ? [[1]]
        : [
            memoryRow({
              content: "verification code is 123456",
              metadata: {
                correspondents: ["\tAlex+Tag@EXAMPLE.TEST\u00A0"],
              },
            }),
          ],
    }));
    const page = await loadAiAgentContext(selected);
    expect(page.items[0]?.content).not.toContain("123456");
    expect(page.items[0]?.correspondents).toContain("alex+tag@example.test");
    expect(page.items[0]?.category).toBe("preferences");
    expect(page.items[0]?.provenance.createdAt).toMatch(/^2026-11-01T/u);
  });

  test.each(["data", "count"])(
    "does not return a page when mailbox access is revoked during the %s read",
    async (read) => {
      fixtures.query.mockImplementation(async (query) => {
        if (query.startsWith("select count(") === (read === "count")) {
          fixtures.access.mockRejectedValue(new ORPCError("NOT_FOUND"));
        }
        return {
          rows: query.startsWith("select count(") ? [[1]] : [memoryRow()],
        };
      });
      await expect(loadAiAgentContext(selected)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    }
  );

  test("keeps selected pages bounded and carries the original snapshot into the next cursor", async () => {
    fixtures.query.mockImplementation(async (query) => ({
      rows: query.startsWith("select count(")
        ? [[150]]
        : Array.from({ length: 101 }, (_, index) =>
            memoryRow({ id: `memory-${String(index).padStart(3, "0")}` })
          ),
    }));
    const cursor = { afterId: "earlier", startedAt: "2026-11-03T00:00:00Z" };
    const page = await loadAiAgentContext({
      ...selected,
      overview: { ...selected.overview, cursor },
    });
    expect(page.hasMore).toBeTruthy();
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThan(101);
    expect(page.nextCursor).toMatchObject({
      afterId: page.items.at(-1)?.id,
      startedAt: "2026-11-03T00:00:00.000Z",
    });
    expect(page.total).toBeGreaterThan(page.items.length);
  });

  test("leaves the original overview unfiltered when no correspondent is selected", async () => {
    const page = await loadAiAgentContext({ overview: {}, userId: "reader" });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).not.toHaveProperty("correspondents");
    expect(fixtures.access).not.toHaveBeenCalled();
    for (const [query] of fixtures.query.mock.calls) {
      expect(query).not.toMatch(/sourceMailboxId|jsonb_array_elements_text/u);
    }
  });
});
