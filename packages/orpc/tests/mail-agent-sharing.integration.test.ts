/* oxlint-disable eslint/require-await -- Provider doubles preserve asynchronous contracts without network calls. */
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { db } from "@quieter/database/client";
import {
  billingSubscription,
  connectorCredential,
  organizationDivision,
  mailboxDivisionGrant,
  mailboxGrant,
  mailbox,
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxAgentSetting,
  managedMailMessage,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { MockLanguageModelV4 } from "ai/test";
import { eq, inArray, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { loadAiAgentContext } from "../src/ai-memory";
import {
  compileAgentManifest,
  loadAgentCatalog,
} from "../src/mail-agent/catalog";
import { drainMailAgentRuns } from "../src/mail-agent/runtime";
import {
  setManagedMailboxAccessMode,
  setManagedMailboxGrant,
  setManagedMailboxDivisionGrant,
} from "../src/mailbox/managed-grants";
import { getManagedThread } from "../src/managed-mail/messages/service";

const state = vi.hoisted(() => ({
  barrier: undefined as (() => Promise<void>) | undefined,
  catalogBarrier: undefined as (() => Promise<void>) | undefined,
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  memory: vi.fn<typeof loadAiAgentContext>().mockResolvedValue({
    instructions: null,
    memory: "Private memory sentinel",
  }),
  model: vi.fn<() => MockLanguageModelV4>(),
  objects: new Map<string, Uint8Array<ArrayBuffer>>(),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      R2_BUCKET: "test",
    },
  };
});
vi.mock(import("@quieter/ai/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: state.model,
}));
vi.mock(import("../src/ai-mail-authorship"), () => ({
  recordAiGeneratedMailBody: async () => {},
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- Preserve the selected-context overload used by background actions.
vi.mock("../src/ai-memory", async () => {
  const { buildMailMemoryQuery, serializeAiAgentContext } =
    await import("../src/ai-memory-context");
  return {
    buildMailMemoryQuery,
    loadAiAgentContext: state.memory,
    serializeAiAgentContext,
  };
});
vi.mock(import("../src/ai-memory-capture"), async (original) => ({
  ...(await original()),
  captureMailboxDraftMemory: async () => null,
}));
vi.mock(import("../src/connectors/linear-mcp"), async (original) => ({
  ...(await original()),
  listLinearMcpToolsForUser: async () => {
    await state.catalogBarrier?.();
    return [
      {
        inputSchema: {
          properties: { id: { type: "string" } },
          required: ["id"],
          type: "object",
        },
        name: "get_issue",
      },
    ];
  },
  runLinearMcpToolCallsForUser: async () => [
    {
      durationMs: 0,
      output: "Private connector sentinel",
      status: "success" as const,
      toolName: "get_issue",
    },
  ],
}));
vi.mock(import("../src/mail-automation/ai-budget"), async (original) => ({
  ...(await original()),
  getMailAutomationAiBudgetStatus: async () => ({
    allowed: true,
    reason: "allowed" as const,
  }),
}));
vi.mock(import("../src/mail-agent/usage"), () => ({
  reportAgentUsage: async () => {},
}));
vi.mock(import("../src/mail-updates"), async (original) => ({
  ...(await original()),
  publishMailUpdate: async () => {},
}));
vi.mock(
  import("../src/managed-mail/messages/raw-object"),
  async (original) => ({
    ...(await original()),
    deleteRawMailObject: async (object) => {
      state.objects.delete(object.key);
    },
    writeRawMailObject: async (object, raw: Uint8Array) => {
      state.objects.set(object.key, new Uint8Array(raw));
      await state.barrier?.();
    },
  })
);

type Generation = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;
const generation = (
  content: Generation["content"],
  tools = false
): Generation => ({
  content,
  finishReason: { raw: undefined, unified: tools ? "tool-calls" : "stop" },
  usage: {
    inputTokens: { cacheRead: 0, cacheWrite: 0, noCache: 10, total: 10 },
    outputTokens: { reasoning: 0, text: 10, total: 10 },
  },
  warnings: [],
});

describe.skipIf(state.databaseUrl === undefined)(
  "generated draft sharing on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const readerId = crypto.randomUUID();
    const connectorId = crypto.randomUUID();
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Sharing tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values(
        [userId, readerId].map((id) => ({
          createdAt: now,
          email: `${id}@example.test`,
          emailVerified: true,
          id,
          name: "Sharing test",
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        billingOwnerUserId: userId,
        createdAt: now,
        id: organizationId,
        name: "Sharing test",
        slug: organizationId,
      });
      await db.insert(member).values(
        [userId, readerId].map((id) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          organizationId,
          role: "owner",
          userId: id,
        }))
      );
      await db.insert(billingSubscription).values({
        cancelAtPeriodEnd: true,
        createdAt: now,
        currentPeriodEnd: new Date(now.getTime() + 86_400_000),
        currentPeriodStart: now,
        id: crypto.randomUUID(),
        metadata: { quieterOrganizationId: organizationId },
        organizationId,
        plan: "pro",
        provider: "polar",
        providerProductId: crypto.randomUUID(),
        providerSubscriptionId: crypto.randomUUID(),
        status: "active",
        updatedAt: now,
        userId,
      });
      await db.insert(connectorCredential).values({
        createdAt: now,
        id: connectorId,
        provider: "linear",
        providerAccountId: connectorId,
        scopes: "read,write",
        updatedAt: now,
        userId,
      });
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(inArray(user.id, [userId, readerId]));
      await db.$client.end();
    });

    test.each([
      "catalog-direct",
      "persistence-direct",
      "persistence-uncommitted-direct",
      "persistence-mode",
      "persistence-division",
      "persistence-owner",
      "persistence-latent-division",
      "private",
      "private-memory",
      "persistence-memory",
      "shared-safe",
    ] as const)("%s", async (scenario) => {
      const mailboxId = crypto.randomUUID();
      const revisionId = crypto.randomUUID();
      const runId = crypto.randomUUID();
      const threadId = crypto.randomUUID();
      const now = new Date();
      const personal = scenario.includes("memory");
      const connected = !personal && scenario !== "shared-safe";
      const safe =
        scenario === "private" ||
        scenario === "private-memory" ||
        scenario === "shared-safe";
      await db.insert(mailbox).values({
        accessMode: scenario === "shared-safe" ? "shared" : "private",
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        managedOwnerUserId: scenario === "shared-safe" ? null : userId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      if (scenario === "shared-safe") {
        await setManagedMailboxGrant({
          mailboxId,
          role: "manager",
          targetUserId: userId,
          userId,
        });
      }
      const specification = actionSpecificationSchema.parse({
        connectors: connected
          ? [{ connectionId: connectorId, referenceId: "tasks" }]
          : [],
        instructions: "Prepare a reply.",
        mailboxId,
        permissions: [
          ...(personal
            ? [{ id: "memory", operation: "read", scope: "memory" }]
            : []),
          { id: "read", operation: "read", scope: "mailbox" },
          { id: "write", operation: "write", scope: "mailbox" },
          ...(connected
            ? [
                {
                  connectorReferenceId: "tasks",
                  id: "tasks",
                  operation: "read",
                  scope: "connector",
                },
              ]
            : []),
        ],
        review: { assumptions: [], questions: [], summary: "Prepare a reply." },
        sourceText: connected
          ? `Prepare a reply using @[connection:${connectorId}].`
          : "Prepare a reply.",
        toolGrants: [
          ...(personal
            ? [
                {
                  confirmation: "none",
                  permissionId: "memory",
                  toolId: "memory.read",
                },
              ]
            : []),
          {
            confirmation: "none",
            permissionId: "read",
            toolId: "mail.read_thread",
          },
          {
            confirmation: "none",
            permissionId: "write",
            toolId: "mail.save_draft",
          },
          ...(connected
            ? [
                {
                  confirmation: "none",
                  permissionId: "tasks",
                  toolId: "linear.get_issue",
                },
              ]
            : []),
        ],
        trigger: { kind: "mail_received" },
        version: 1,
      });
      const manifest = compileAgentManifest(
        specification,
        await loadAgentCatalog({
          connectionIds: connected ? [connectorId] : [],
          userId,
        })
      );
      await db.insert(mailboxAgentRevision).values({
        createdAt: now,
        createdByUserId: userId,
        id: revisionId,
        mailboxId,
        manifest: manifest.manifest,
        manifestDigest: manifest.digest,
        specification,
      });
      await db.insert(mailboxAgentSetting).values({
        activatedByUserId: userId,
        activationVersion: 1,
        activeRevisionId: revisionId,
        createdAt: now,
        enabled: true,
        mailboxId,
        updatedAt: now,
      });
      await db.insert(managedMailMessage).values({
        bodyText: "Please prepare a reply.",
        createdAt: now,
        direction: "inbound",
        from: "sender@example.test",
        id: crypto.randomUUID(),
        mailboxId,
        mailboxState: "active",
        providerMessageId: crypto.randomUUID(),
        sentAt: now,
        threadId,
        to: `${mailboxId}@example.test`,
        updatedAt: now,
      });
      await db.insert(mailboxAgentRun).values({
        actorUserId: userId,
        createdAt: now,
        id: runId,
        invocationKey: runId,
        mailboxId,
        revisionId,
        settingVersion: 1,
        threadId,
        triggerKind: "manual",
        updatedAt: now,
      });
      let bodyText = "Safe reply";
      if (connected) {
        bodyText = "Private connector sentinel";
      }
      if (personal) {
        bodyText = "Private memory sentinel";
      }
      let step = 0;
      state.model.mockReturnValue(
        new MockLanguageModelV4({
          doGenerate: async ({ prompt }) => {
            step += 1;
            if (connected && step === 1) {
              return generation(
                [
                  {
                    input: JSON.stringify({ id: "issue" }),
                    toolCallId: "connector",
                    toolName: "capability_2",
                    type: "tool-call",
                  },
                ],
                true
              );
            }
            if (step === (connected ? 2 : 1)) {
              if (connected || personal) {
                // oxlint-disable-next-line vitest/no-conditional-expect -- Only private-context scenarios consume a connector or memory result.
                expect(JSON.stringify(prompt)).toContain(bodyText);
              }
              return generation(
                [
                  {
                    input: JSON.stringify({
                      bodyText,
                      subject: "Reply",
                      to: "sender@example.test",
                    }),
                    toolCallId: "draft",
                    toolName: `capability_${manifest.tools.findIndex((tool) => tool.toolId === "mail.save_draft")}`,
                    type: "tool-call",
                  },
                ],
                true
              );
            }
            return generation([
              {
                text: JSON.stringify({
                  matched: true,
                  summary: "Prepared reply.",
                }),
                type: "text",
              },
            ]);
          },
        })
      );
      const paused = Promise.withResolvers<boolean>();
      const resume = Promise.withResolvers<boolean>();
      let catalogCalls = 0;
      state.catalogBarrier =
        scenario === "catalog-direct"
          ? async () => {
              catalogCalls += 1;
              if (catalogCalls === 3) {
                paused.resolve(true);
                await resume.promise;
              }
            }
          : undefined;
      state.barrier = scenario.startsWith("persistence")
        ? async () => {
            paused.resolve(true);
            await resume.promise;
          }
        : undefined;
      const running = drainMailAgentRuns({ limit: 1 });
      try {
        if (scenario.includes("direct") || scenario.startsWith("persistence")) {
          await paused.promise;
          if (scenario === "persistence-uncommitted-direct") {
            const inserted = Promise.withResolvers<boolean>();
            const commit = Promise.withResolvers<boolean>();
            const sharing = db.transaction(async (tx) => {
              await tx
                .select({ id: mailbox.id })
                .from(mailbox)
                .where(eq(mailbox.id, mailboxId))
                .for("update");
              await tx.insert(mailboxGrant).values({
                createdAt: now,
                id: crypto.randomUUID(),
                mailboxId,
                role: "reader",
                updatedAt: now,
                userId: readerId,
              });
              inserted.resolve(true);
              await commit.promise;
            });
            try {
              await inserted.promise;
              resume.resolve(true);
              await vi.waitFor(async () => {
                const waiting = await db.execute(
                  sql`select pid from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%"managedOwnerUserId"%for update%'`
                );
                // oxlint-disable-next-line vitest/no-conditional-expect -- The uncommitted sharing scenario must observe the actual lock wait.
                expect(waiting.length).toBeGreaterThan(0);
              });
            } finally {
              commit.resolve(true);
              await sharing;
            }
          } else if (scenario === "persistence-owner") {
            await setManagedMailboxAccessMode({
              accessMode: "private",
              mailboxId,
              ownerUserId: readerId,
              userId: readerId,
            });
          } else if (scenario.includes("division")) {
            const divisionId = crypto.randomUUID();
            await db.insert(organizationDivision).values({
              createdAt: now,
              id: divisionId,
              name: "Test division",
              normalizedName: divisionId,
              organizationId,
              updatedAt: now,
            });
            if (scenario === "persistence-division") {
              await setManagedMailboxAccessMode({
                accessMode: "shared",
                mailboxId,
                userId: readerId,
              });
              await setManagedMailboxDivisionGrant({
                divisionId,
                mailboxId,
                role: "reader",
                userId: readerId,
              });
            } else {
              await db.transaction(async (tx) => {
                await tx
                  .select({ id: mailbox.id })
                  .from(mailbox)
                  .where(eq(mailbox.id, mailboxId))
                  .for("update");
                await tx.insert(mailboxDivisionGrant).values({
                  createdAt: now,
                  divisionId,
                  id: crypto.randomUUID(),
                  mailboxId,
                  role: "reader",
                  updatedAt: now,
                });
              });
            }
          } else if (scenario === "persistence-mode") {
            await setManagedMailboxAccessMode({
              accessMode: "shared",
              mailboxId,
              userId: readerId,
            });
          } else {
            await setManagedMailboxGrant({
              mailboxId,
              role: "reader",
              targetUserId: readerId,
              userId: readerId,
            });
          }
        }
      } finally {
        resume.resolve(true);
      }
      await running;
      state.barrier = undefined;
      state.catalogBarrier = undefined;
      const drafts = await db
        .select()
        .from(managedMailMessage)
        .where(eq(managedMailMessage.mailboxId, mailboxId));
      const saved = drafts.filter(
        (message) => message.mailboxState === "draft"
      );
      if (safe) {
        // oxlint-disable-next-line vitest/no-conditional-expect -- Successful controls must persist their draft.
        expect(saved).toMatchObject([{ bodyText }]);
      } else {
        // oxlint-disable-next-line vitest/no-conditional-expect -- Sharing races must leave no draft.
        expect(saved).toHaveLength(0);
        if (scenario.includes("direct")) {
          const visible = await getManagedThread({
            mailboxId,
            threadId,
            userId: readerId,
          });
          // oxlint-disable-next-line vitest/no-conditional-expect -- Direct-reader scenarios must also prove the draft is not visible.
          expect(
            visible.messages.some(
              (message) => message.bodyText?.includes(bodyText) === true
            )
          ).toBeFalsy();
        }
      }
      const [run] = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.id, runId));
      expect(run?.status).toBe(safe ? "succeeded" : "needs_attention");
    });
  }
);
