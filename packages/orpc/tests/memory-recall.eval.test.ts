import { writeFile } from "node:fs/promises";

import { db } from "@quieter/database/client";
import {
  aiMemory,
  mailbox,
  mailboxGrant,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";
import { z } from "zod";

import { loadAiAgentContext, saveAiMemory } from "../src/ai-memory";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  reportPath: process.env.MEMORY_EVAL_REPORT,
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "production" as const,
    },
  };
});
vi.mock(import("sst"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    Resource: new Proxy(actual.Resource, {
      get() {
        throw new Error(
          "Linked resources are disabled in synthetic evaluation."
        );
      },
    }),
  };
});

vi.mock(import("@quieter/observability"), async (original) => ({
  ...(await original()),
  reportError: vi.fn<typeof reportError>(),
}));

type Fact = Pick<typeof aiMemory.$inferInsert, "key" | "content" | "metadata"> &
  Partial<
    Pick<typeof aiMemory.$inferInsert, "status" | "expiresAt" | "importance">
  > & { owner?: "other" };
type Scenario = {
  id: string;
  kind: "contract" | "quality-probe";
  facts: Fact[];
  agent: string;
  query: string;
  mailbox: "primary" | "secondary" | "shared";
  relevant: string[];
  forbidden: string[];
  edit?: { key: string; content: string };
};
const voice: Fact = {
  content: "Prefers concise warm replies with natural contractions.",
  key: "voice",
  metadata: { agents: ["all"], category: "writing_style" },
};
const recipient: Fact = {
  content: "With Alex, use informal German and playful greetings.",
  key: "alex",
  metadata: {
    agents: ["all"],
    category: "writing_style",
    correspondents: ["alex@example.test"],
  },
};
const distractors: Fact[] = Array.from({ length: 45 }, (_, index) => ({
  content: `Project ${index} is migrating its deployment pipeline.`,
  importance: 5,
  key: `project-${index}`,
  metadata: { agents: ["all"], category: "work" },
}));
const scenarios: Scenario[] = [
  {
    agent: "reply_suggestion",
    facts: [voice, recipient, ...distractors],
    forbidden: [],
    id: "recipient-and-general-voice",
    kind: "contract",
    mailbox: "primary",
    query: "Reply to alex@example.test about lunch",
    relevant: ["voice", "alex"],
  },
  {
    agent: "reply_suggestion",
    facts: [voice, recipient],
    forbidden: ["alex"],
    id: "recipient-exclusion",
    kind: "contract",
    mailbox: "primary",
    query: "Reply to blair@example.test",
    relevant: ["voice"],
  },
  {
    agent: "search",
    facts: [
      {
        content: "The user's husband is Blair, blair@example.test.",
        key: "partner",
        metadata: { agents: ["all"], category: "relationships" },
      },
      ...distractors,
    ],
    forbidden: [],
    id: "relationship-reference",
    kind: "contract",
    mailbox: "primary",
    query: "Find messages from my husband",
    relevant: ["partner"],
  },
  {
    agent: "chat",
    facts: [
      voice,
      {
        content: "Other reader prefers long formal introductions.",
        key: "foreign",
        metadata: { agents: ["all"], category: "writing_style" },
        owner: "other",
      },
    ],
    forbidden: ["foreign"],
    id: "shared-mailbox-personal-isolation",
    kind: "contract",
    mailbox: "shared",
    query: "What are my writing preferences?",
    relevant: ["voice"],
  },
  {
    agent: "compose",
    facts: [voice],
    forbidden: [],
    id: "general-preferences-cross-mailboxes",
    kind: "contract",
    mailbox: "secondary",
    query: "Draft a message",
    relevant: ["voice"],
  },
  {
    agent: "auto_label",
    facts: [
      {
        content: "Prefer the Travel label for itinerary confirmations.",
        key: "label",
        metadata: { agents: ["all"], category: "labeling" },
      },
    ],
    forbidden: [],
    id: "label-rule-origin",
    kind: "contract",
    mailbox: "primary",
    query: "Travel itinerary",
    relevant: ["label"],
  },
  {
    agent: "auto_label",
    facts: [
      {
        content: "Prefer the Travel label for itinerary confirmations.",
        key: "label",
        metadata: { agents: ["all"], category: "labeling" },
      },
    ],
    forbidden: ["label"],
    id: "label-rule-other-mailbox",
    kind: "contract",
    mailbox: "secondary",
    query: "Travel itinerary",
    relevant: [],
  },
  {
    agent: "compose",
    facts: [
      voice,
      {
        content: "Temporarily prefers formal greetings.",
        expiresAt: new Date("2020-01-01"),
        key: "expired",
        metadata: { category: "preferences" },
      },
      {
        content: "Prefers elaborate email signatures.",
        key: "archived",
        metadata: { category: "writing_style" },
        status: "archived",
      },
    ],
    forbidden: ["expired", "archived"],
    id: "expired-and-archived",
    kind: "contract",
    mailbox: "primary",
    query: "Draft a greeting and signature",
    relevant: ["voice"],
  },
  {
    agent: "compose",
    edit: {
      content: "Prefers detailed explanations with a formal greeting.",
      key: "voice",
    },
    facts: [voice],
    forbidden: [],
    id: "manual-edit-freshness",
    kind: "contract",
    mailbox: "primary",
    query: "Draft a reply",
    relevant: ["voice"],
  },
  {
    agent: "chat",
    facts: [
      {
        content: "Avoids red-eye flights.",
        importance: 1,
        key: "flight",
        metadata: { agents: ["all"], category: "preferences" },
      },
      ...Array.from({ length: 30 }, (_, index): Fact => ({
        content: `Prefers the ${index}th garden layout in the landscape catalog.`,
        importance: 5,
        key: `preference-${index}`,
        metadata: { agents: ["all"], category: "preferences" },
      })),
    ],
    forbidden: [],
    id: "word-disjoint-semantic-recall",
    kind: "quality-probe",
    mailbox: "primary",
    query: "How should I choose an overnight journey by air?",
    relevant: ["flight"],
  },
];
const resultSchema = z.object({ text: z.string() });
const results: {
  id: string;
  kind: Scenario["kind"];
  status: "pass" | "fail" | "hit" | "miss";
  matched: string[];
  missing: string[];
  forbidden: string[];
  returnedCharacters: number;
}[] = [];

describe.skipIf(state.databaseUrl === undefined)(
  "synthetic canonical SQL memory evaluation",
  () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const mailboxes = {
      foreign: crypto.randomUUID(),
      primary: crypto.randomUUID(),
      secondary: crypto.randomUUID(),
      shared: crypto.randomUUID(),
    };
    const now = new Date();
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test" ||
        url.search ||
        url.hash
      ) {
        throw new Error(
          "Evaluation requires disposable loopback quieter_migration_test."
        );
      }
      await db.execute(sql`select 1 from ${aiMemory} limit 1`);
      await db.insert(user).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Synthetic evaluator",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Synthetic evaluation",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          id: `member-${id}`,
          organizationId,
          role: "member",
          userId: id,
        }))
      );
      const owners: Record<string, string | null> = {
        foreign: otherUserId,
        primary: userId,
        secondary: userId,
        shared: null,
      };
      await db.insert(mailbox).values(
        Object.entries(mailboxes).map(([name, id]) => ({
          accessMode:
            name === "shared" ? ("shared" as const) : ("private" as const),
          createdAt: now,
          emailAddress: `${id}@example.test`,
          id,
          organizationId,
          ownerUserId: owners[name],
          provider:
            name === "shared" ? ("managed" as const) : ("gmail" as const),
          updatedAt: now,
        }))
      );
      await db.insert(mailboxGrant).values(
        [userId, otherUserId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId: mailboxes.shared,
          memberId: `member-${id}`,
          role: "reader" as const,
          updatedAt: now,
          userId: id,
        }))
      );
    });

    afterAll(async () => {
      await db
        .delete(aiMemory)
        .where(inArray(aiMemory.userId, [userId, otherUserId]));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
      if (state.reportPath) {
        await writeFile(
          state.reportPath,
          JSON.stringify(
            {
              cases: results,
              layer: "canonical-sql-recall",
              measured: [
                "retrieved-fact-coverage",
                "forbidden-fact-exposure",
                "returned-characters",
              ],
              provider: "quieter",
              status:
                results.length === scenarios.length + 1
                  ? "complete"
                  : "incomplete",
              unmeasured: [
                "extraction",
                "deletion-replay",
                "generation",
                "tokens",
                "cost",
                "latency",
                "supermemory",
              ],
              version: 1,
            },
            null,
            2
          )
        );
      }
    });

    test("inaccessible-mailbox-rejected", async () => {
      await expect(
        loadAiAgentContext({
          agent: "chat",
          mailboxId: mailboxes.foreign,
          query: "Show preferences",
          userId,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      results.push({
        forbidden: [],
        id: "inaccessible-mailbox-rejected",
        kind: "contract",
        matched: [],
        missing: [],
        returnedCharacters: 0,
        status: "pass",
      });
    });

    test.each(scenarios)("$id", async (scenario) => {
      vi.mocked(reportError).mockClear();
      await db
        .delete(aiMemory)
        .where(inArray(aiMemory.userId, [userId, otherUserId]));
      const facts = scenario.facts.map(({ owner, ...fact }) => ({
        ...fact,
        id: `${userId}:${owner ?? "actor"}:${fact.key}`,
        userId: owner === "other" ? otherUserId : userId,
      }));
      await db.insert(aiMemory).values(
        facts.map((fact): typeof aiMemory.$inferInsert => ({
          ...fact,
          confidence: 1,
          createdAt: now,
          importance: fact.importance ?? 3,
          kind: "learned",
          lastConfirmedAt: now,
          metadata: {
            ...fact.metadata,
            ...(fact.key === "label"
              ? { sourceMailboxId: mailboxes.primary }
              : {}),
          },
          scope: "user",
          scopeKey: `user:${fact.userId}`,
          source: "explicit",
          summary: fact.content,
          updatedAt: now,
        }))
      );
      if (scenario.edit) {
        const fact = facts.find(({ key }) => key === scenario.edit?.key);
        if (!fact) {
          throw new Error("Edit fixture missing.");
        }
        const before = await loadAiAgentContext({
          agent: scenario.agent,
          mailboxId: mailboxes[scenario.mailbox],
          query: scenario.query,
          userId,
        });
        // oxlint-disable-next-line vitest/no-conditional-expect -- Only freshness scenarios have an explicit edit.
        expect(before.memory).toContain(fact.content);
        const oldContent = fact.content;
        await saveAiMemory({
          category: "writing_style",
          content: scenario.edit.content,
          memoryId: fact.id,
          userId,
          version: 1,
        });
        const after = await loadAiAgentContext({
          agent: scenario.agent,
          mailboxId: mailboxes[scenario.mailbox],
          query: scenario.query,
          userId,
        });
        // oxlint-disable-next-line vitest/no-conditional-expect -- Only freshness scenarios have an explicit edit.
        expect(after.memory).not.toContain(oldContent);
        fact.content = scenario.edit.content;
      }
      const context = await loadAiAgentContext({
        agent: scenario.agent,
        mailboxId: mailboxes[scenario.mailbox],
        query: scenario.query,
        userId,
      });
      expect(reportError).not.toHaveBeenCalled();
      const texts = new Set(
        [context.instructions, context.memory]
          .flatMap((value) =>
            (value ?? "").split("\n").filter((line) => line.startsWith("{"))
          )
          .map((line) => resultSchema.parse(JSON.parse(line)).text)
      );
      const matched = facts
        .filter(({ content }) => texts.has(content))
        .map(({ key }) => key);
      const missing = scenario.relevant.filter((key) => !matched.includes(key));
      const forbidden = scenario.forbidden.filter((key) =>
        matched.includes(key)
      );
      const correct = missing.length === 0 && forbidden.length === 0;
      const statuses =
        scenario.kind === "quality-probe"
          ? { failure: "miss" as const, success: "hit" as const }
          : { failure: "fail" as const, success: "pass" as const };
      results.push({
        forbidden,
        id: scenario.id,
        kind: scenario.kind,
        matched,
        missing,
        returnedCharacters:
          (context.instructions?.length ?? 0) + (context.memory?.length ?? 0),
        status: correct ? statuses.success : statuses.failure,
      });
      if (scenario.kind === "contract") {
        // oxlint-disable-next-line vitest/no-conditional-expect -- Quality probes record misses instead of failing contracts.
        expect({ forbidden, missing }).toMatchObject({
          forbidden: [],
          missing: [],
        });
      }
    });
  }
);
