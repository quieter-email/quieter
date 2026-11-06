import { writeFile } from "node:fs/promises";

import { SEARCH_EMBEDDING_MODEL_KEY } from "@quieter/ai/search-embeddings";
import type { reportAiUsage } from "@quieter/billing";
import type { createMailboxAiBillingContext } from "@quieter/billing/ai-reservation";
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

import { memoryRecallScenarios as scenarios } from "../evals/memory-recall-scenarios";
import type { Scenario } from "../evals/memory-recall-scenarios";
import { loadAiAgentContext, saveAiMemory } from "../src/ai-memory";
import { indexSemanticSources } from "../src/semantic-search";
import type { SemanticSearchCoverage } from "../src/semantic-search";

const state = vi.hoisted(() => ({
  caseId: process.env.MEMORY_EVAL_CASE,
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  organizationId: crypto.randomUUID(),
  reportPath: process.env.MEMORY_EVAL_REPORT,
  semantic: process.env.MEMORY_EVAL_SEMANTIC === "true",
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

vi.mock(import("@quieter/billing/ai-reservation"), async (original) => ({
  ...(await original()),
  createMailboxAiBillingContext: vi
    .fn<typeof createMailboxAiBillingContext>()
    .mockResolvedValue({
      account: null,
      admittedAt: new Date(),
      groupId: crypto.randomUUID(),
      kind: "team",
      organizationId: state.organizationId,
      usageKind: "aiMemory",
    }),
}));
vi.mock(import("@quieter/billing"), async (original) => ({
  ...(await original()),
  reportAiUsage: vi.fn<typeof reportAiUsage>(),
}));

const selectedScenarios = scenarios.filter(
  (scenario) => !state.caseId || scenario.id === state.caseId
);

const resultSchema = z.object({ text: z.string() });
const results: {
  id: string;
  kind: Scenario["kind"];
  status: "pass" | "fail" | "hit" | "miss";
  matched: string[];
  missing: string[];
  forbidden: string[];
  returnedCharacters: number;
  indexCoverage?: SemanticSearchCoverage;
}[] = [];

describe.skipIf(state.databaseUrl === undefined)(
  "synthetic canonical SQL memory evaluation",
  () => {
    const userId = crypto.randomUUID();
    const otherUserId = crypto.randomUUID();
    const { organizationId } = state;
    const mailboxes = {
      foreign: crypto.randomUUID(),
      primary: crypto.randomUUID(),
      secondary: crypto.randomUUID(),
      shared: crypto.randomUUID(),
    };
    const now = new Date();
    let fixturesMayExist = false;
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
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
      fixturesMayExist = true;
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
      if (fixturesMayExist) {
        await db
          .delete(aiMemory)
          .where(inArray(aiMemory.userId, [userId, otherUserId]));
        await db
          .delete(organization)
          .where(eq(organization.id, organizationId));
        await db.delete(user).where(inArray(user.id, [userId, otherUserId]));
      }
      if (state.reportPath) {
        await writeFile(
          state.reportPath,
          JSON.stringify(
            {
              cases: results,
              configuredEmbeddingModel: state.semantic
                ? SEARCH_EMBEDDING_MODEL_KEY
                : null,
              layer: "canonical-sql-recall",
              measured: [
                "retrieved-fact-coverage",
                "forbidden-fact-exposure",
                "returned-characters",
              ],
              mode: state.semantic ? "semantic-live" : "lexical",
              provider: "quieter",
              retrieval: state.semantic ? "hybrid-embedding" : "lexical",
              status:
                results.length === selectedScenarios.length + 1
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
              version: 2,
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

    test.each(selectedScenarios)(
      "$id",
      async (scenario) => {
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
        let indexCoverage: SemanticSearchCoverage | undefined;
        if (state.semantic) {
          for (let attempt = 0; attempt <= facts.length; attempt += 1) {
            indexCoverage = await indexSemanticSources({
              kind: "memory",
              mailboxId: mailboxes[scenario.mailbox],
              userId,
            });
            if (indexCoverage.complete) {
              break;
            }
          }
          if (indexCoverage?.complete !== true) {
            throw new Error("Synthetic memory indexing did not complete.");
          }
        }
        if (scenario.edit) {
          const fact = facts.find(({ key }) => key === scenario.edit?.key);
          if (!fact) {
            throw new Error("Edit fixture missing.");
          }
          const before = await loadAiAgentContext({
            ...(state.semantic
              ? { semantic: { billingMailboxId: mailboxes[scenario.mailbox] } }
              : {}),
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
            ...(state.semantic
              ? { semantic: { billingMailboxId: mailboxes[scenario.mailbox] } }
              : {}),
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
          ...(state.semantic
            ? { semantic: { billingMailboxId: mailboxes[scenario.mailbox] } }
            : {}),
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
        const missing = scenario.relevant.filter(
          (key) => !matched.includes(key)
        );
        const forbidden = scenario.forbidden.filter((key) =>
          matched.includes(key)
        );
        const correct = missing.length === 0 && forbidden.length === 0;
        const statuses =
          scenario.kind === "quality-probe"
            ? { failure: "miss" as const, success: "hit" as const }
            : { failure: "fail" as const, success: "pass" as const };
        results.push({
          ...(indexCoverage === undefined ? {} : { indexCoverage }),
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
      },
      state.semantic ? 120_000 : 15_000
    );
  }
);
