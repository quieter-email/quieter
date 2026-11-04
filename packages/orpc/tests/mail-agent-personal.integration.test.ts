/* oxlint-disable eslint/require-await -- Provider doubles retain their asynchronous contracts without external requests. */
import { actionSpecificationSchema } from "@quieter/ai/action-specification";
import { db } from "@quieter/database/client";
import {
  billingSubscription,
  connectorCredential,
  mailbox,
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxGrant,
  mailboxPersonalAgentSetting,
  member,
  organization,
  user,
} from "@quieter/database/schema";
import { MockLanguageModelV4 } from "ai/test";
import { and, eq, inArray } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { runLinearMcpToolCallsForUser } from "../src/connectors/linear-mcp";
import { disconnectConnector } from "../src/connectors/service";
import {
  compileAgentManifest,
  loadAgentCatalog,
} from "../src/mail-agent/catalog";
import { enqueueMailAgentMessage } from "../src/mail-agent/inbox";
import { drainMailAgentRuns } from "../src/mail-agent/runtime";
import {
  activateMailAgent,
  enqueueManualMailAgentRun,
  getMailAgentSettings,
  getMailAgentThreadResults,
  pauseMailAgent,
} from "../src/mail-agent/service";

const state = vi.hoisted(() => ({
  beforeGenerate: undefined as (() => Promise<void>) | undefined,
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  linear: vi.fn<typeof runLinearMcpToolCallsForUser>(),
  messageId: "",
  threadId: "",
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      POLAR_PRODUCT_PRO_ID: "personal-pro-product",
    },
  };
});
vi.mock(import("@quieter/ai/openrouter"), async (original) => ({
  ...(await original()),
  createChatModel: () =>
    new MockLanguageModelV4({
      doGenerate: async () => {
        await state.beforeGenerate?.();
        return {
          content: [
            {
              text: JSON.stringify({
                matched: true,
                summary: "My private action result.",
              }),
              type: "text",
            },
          ],
          finishReason: { raw: undefined, unified: "stop" },
          usage: {
            inputTokens: {
              cacheRead: 0,
              cacheWrite: 0,
              noCache: 10,
              total: 10,
            },
            outputTokens: { reasoning: 0, text: 10, total: 10 },
          },
          warnings: [],
        };
      },
    }),
}));
vi.mock(import("../src/connectors/linear-mcp"), async (original) => ({
  ...(await original()),
  listLinearMcpToolsForUser: async () => [
    {
      inputSchema: {
        properties: { team: { type: "string" }, title: { type: "string" } },
        required: ["team", "title"],
        type: "object",
      },
      name: "save_issue",
    },
  ],
  runLinearMcpToolCallsForUser: state.linear,
}));
vi.mock(import("../src/mail-automation/ai-budget"), async (original) => ({
  ...(await original()),
  getMailAutomationAiBudgetStatus: async () => ({
    allowed: true,
    reason: "allowed" as const,
  }),
}));
// oxlint-disable-next-line vitest/prefer-import-in-mock -- The provider boundary needs only the action's thread projection.
vi.mock("../src/mail/queries", () => ({
  queriesMailOperations: {
    getThread: async () => ({
      messages: [
        {
          bodyText: "A shared incoming message.",
          from: "sender@example.test",
          id: state.messageId,
          subject: "Requested task",
        },
      ],
      threadId: state.threadId,
    }),
  },
}));
vi.mock(import("../src/mail-agent/usage"), () => ({
  reportAgentUsage: async () => {},
}));
vi.mock(import("../src/mail-updates"), async (original) => ({
  ...(await original()),
  publishMailUpdate: async () => {},
}));

describe.skipIf(state.databaseUrl === undefined)(
  "personal actions on a shared PostgreSQL inbox",
  () => {
    const organizationId = crypto.randomUUID();
    const alice = {
      connectionId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    const bob = {
      connectionId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    const reader = {
      connectionId: crypto.randomUUID(),
      memberId: crypto.randomUUID(),
      userId: crypto.randomUUID(),
    };
    const people = [alice, bob, reader];
    let mailboxId: string;
    const revisions = new Map<string, string>();
    const createAction = async (person: typeof alice, draft = false) => {
      const revisionId = crypto.randomUUID();
      const specification = actionSpecificationSchema.parse({
        connectors: draft
          ? []
          : [{ connectionId: person.connectionId, referenceId: "selected" }],
        eligibility: {
          bodyIncludes: [],
          sender: { addresses: ["sender@example.test"], kind: "addresses" },
          subjectIncludes: [],
        },
        instructions: `Private instructions for ${person.userId}`,
        mailboxId,
        permissions: [
          { id: "read", operation: "read", scope: "mailbox" },
          draft
            ? { id: "write", operation: "write", scope: "mailbox" }
            : {
                connectorReferenceId: "selected",
                id: "write",
                operation: "write",
                scope: "connector",
              },
        ],
        review: {
          assumptions: [],
          questions: [],
          summary: `Private review for ${person.userId}`,
        },
        sourceText: draft
          ? "Prepare a reply draft."
          : `My private task in @[connection:${person.connectionId}].`,
        toolGrants: [
          {
            confirmation: "none",
            permissionId: "read",
            toolId: "mail.read_thread",
          },
          draft
            ? {
                confirmation: "none",
                permissionId: "write",
                toolId: "mail.save_draft",
              }
            : {
                argumentTemplate: JSON.stringify({
                  team: `team-${person.userId}`,
                  title: "{{message.subject}}",
                }),
                confirmation: "none",
                permissionId: "write",
                toolId: "linear.save_issue",
              },
        ],
        trigger: { kind: "mail_received" },
        version: 1,
      });
      const compiled = compileAgentManifest(
        specification,
        await loadAgentCatalog({
          connectionIds: draft ? [] : [person.connectionId],
          userId: person.userId,
        })
      );
      const now = new Date();
      await db.insert(mailboxAgentRevision).values({
        createdAt: now,
        createdByUserId: person.userId,
        id: revisionId,
        mailboxId,
        manifest: {
          capabilities: compiled.tools.map(
            ({ accountLabel, label, operation, toolId }) => ({
              accountLabel,
              label,
              operation,
              toolId,
            })
          ),
          entries: compiled.manifest,
        },
        manifestDigest: compiled.digest,
        specification,
      });
      await db.insert(mailboxPersonalAgentSetting).values({
        createdAt: now,
        draftRevisionId: revisionId,
        mailboxId,
        memberId: person.memberId,
        updatedAt: now,
        userId: person.userId,
        version: 1,
      });
      revisions.set(person.userId, revisionId);
      return revisionId;
    };
    const activateBoth = async () => {
      for (const person of [alice, bob]) {
        const revisionId = revisions.get(person.userId);
        if (!revisionId) {
          throw new Error("Missing owned review.");
        }
        // oxlint-disable-next-line eslint/no-await-in-loop -- Each independent owner explicitly activates their own reviewed action.
        await activateMailAgent({
          acknowledgeAssumptions: true,
          mailboxId,
          revisionId,
          userId: person.userId,
          version: 1,
        });
      }
    };
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Personal action tests require disposable loopback PostgreSQL."
        );
      }
      const now = new Date();
      await db.insert(user).values(
        people.map((person) => ({
          createdAt: now,
          email: `${person.userId}@example.test`,
          emailVerified: true,
          id: person.userId,
          name: `Synthetic ${person.userId}`,
          updatedAt: now,
        }))
      );
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Private action isolation",
        slug: organizationId,
      });
      await db.insert(member).values(
        people.map((person) => ({
          createdAt: now,
          id: person.memberId,
          organizationId,
          role: person.userId === reader.userId ? "owner" : "member",
          userId: person.userId,
        }))
      );
      await db
        .update(organization)
        .set({ billingOwnerUserId: reader.userId })
        .where(eq(organization.id, organizationId));
      await db.insert(billingSubscription).values({
        cancelAtPeriodEnd: true,
        createdAt: now,
        currentPeriodEnd: new Date(now.getTime() + 86_400_000),
        currentPeriodStart: now,
        id: crypto.randomUUID(),
        metadata: {
          quieterProduct: "pro",
          quieterScope: "account",
          quieterUserId: reader.userId,
        },
        organizationId: null,
        periodCreditAmountCents: 2000,
        plan: "pro",
        provider: "polar",
        providerCustomerId: crypto.randomUUID(),
        providerProductId: "personal-pro-product",
        providerSubscriptionId: crypto.randomUUID(),
        scope: "account",
        status: "active",
        updatedAt: now,
        userId: reader.userId,
      });
      await db.insert(connectorCredential).values(
        [alice, bob].map((person) => ({
          accountEmail: `${person.userId}@example.test`,
          createdAt: now,
          displayName: "Tasks",
          id: person.connectionId,
          provider: "linear" as const,
          providerAccountId: person.connectionId,
          scopes: "read,write",
          updatedAt: now,
          userId: person.userId,
        }))
      );
    });
    beforeEach(async () => {
      revisions.clear();
      state.beforeGenerate = undefined;
      state.linear.mockReset().mockResolvedValue([
        {
          durationMs: 0,
          output: { id: "created-issue" },
          status: "success",
          toolName: "save_issue",
        },
      ]);
      mailboxId = crypto.randomUUID();
      state.messageId = crypto.randomUUID();
      state.threadId = crypto.randomUUID();
      const now = new Date();
      await db.insert(mailbox).values({
        accessMode: "shared",
        createdAt: now,
        emailAddress: `${mailboxId}@example.test`,
        id: mailboxId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(mailboxGrant).values(
        people.map((person) => ({
          createdAt: now,
          id: crypto.randomUUID(),
          mailboxId,
          memberId: person.memberId,
          role: "reader" as const,
          updatedAt: now,
          userId: person.userId,
        }))
      );
      await createAction(alice);
      await createAction(bob);
    });
    afterEach(async () => {
      await db.delete(mailbox).where(eq(mailbox.id, mailboxId));
    });

    afterAll(async () => {
      await db
        .delete(billingSubscription)
        .where(eq(billingSubscription.userId, reader.userId));
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(
        inArray(
          user.id,
          people.map((person) => person.userId)
        )
      );
      await db.$client.end();
    });

    test("exposes only the viewer's private review and accounts without revealing other actions", async () => {
      const own = await getMailAgentSettings({
        mailboxId,
        userId: alice.userId,
      });
      expect(own.draft?.id).toBe(revisions.get(alice.userId));
      expect(own.accounts.map((account) => account.connectionId)).toStrictEqual(
        [alice.connectionId]
      );
      expect(own.accounts[0]?.label).toContain(`${alice.userId}@example.test`);
      expect(JSON.stringify(own)).not.toContain(bob.connectionId);
      expect(JSON.stringify(own)).not.toContain(bob.userId);
      const empty = await getMailAgentSettings({
        mailboxId,
        userId: reader.userId,
      });
      expect(empty).toMatchObject({
        accounts: [],
        active: null,
        canSaveDraft: false,
        draft: null,
        shared: true,
      });
      expect(JSON.stringify(empty)).not.toContain(alice.connectionId);
    });

    test("rejects another user's revision and keeps activation and pause independent", async () => {
      await expect(
        activateMailAgent({
          acknowledgeAssumptions: true,
          mailboxId,
          revisionId: revisions.get(alice.userId) ?? "",
          userId: bob.userId,
          version: 1,
        })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await activateBoth();
      await pauseMailAgent({ mailboxId, userId: alice.userId, version: 2 });
      const ownState = await getMailAgentSettings({
        mailboxId,
        userId: alice.userId,
      });
      const otherState = await getMailAgentSettings({
        mailboxId,
        userId: bob.userId,
      });
      expect(ownState.setting.enabled).toBeFalsy();
      expect(otherState.setting.enabled).toBeTruthy();
    });

    test("fans one arrival out once per owner and runs both triggers with that owner's exact account", async () => {
      await activateBoth();
      const incoming = {
        mailboxId,
        messageId: state.messageId,
        receivedAt: new Date(Date.now() + 1000),
        threadId: state.threadId,
      };
      await Promise.all([
        enqueueMailAgentMessage(incoming),
        enqueueMailAgentMessage(incoming),
        enqueueMailAgentMessage(incoming),
      ]);
      const incomingRuns = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, mailboxId));
      expect(incomingRuns).toHaveLength(2);
      expect(incomingRuns.every((run) => run.privateResult)).toBeTruthy();
      const invocationId = crypto.randomUUID();
      const manual = await Promise.all(
        [alice, bob].map(
          async (person) =>
            await enqueueManualMailAgentRun({
              invocationId,
              mailboxId,
              threadId: state.threadId,
              userId: person.userId,
            })
        )
      );
      expect(new Set(manual.map((run) => run.runId)).size).toBe(2);
      await drainMailAgentRuns({ limit: 3 });
      await drainMailAgentRuns({ limit: 3 });
      const finishedRuns = await db
        .select({
          errorMessage: mailboxAgentRun.errorMessage,
          status: mailboxAgentRun.status,
        })
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, mailboxId));
      expect(finishedRuns).toStrictEqual(
        expect.arrayContaining([{ errorMessage: null, status: "succeeded" }])
      );
      expect(
        state.linear.mock.calls.map(([call]) => ({
          connectionId: call.connectionId,
          userId: call.userId,
        }))
      ).toStrictEqual(
        expect.arrayContaining([
          { connectionId: alice.connectionId, userId: alice.userId },
          { connectionId: bob.connectionId, userId: bob.userId },
        ])
      );
      expect(state.linear).toHaveBeenCalledTimes(4);
      const ownResults = await getMailAgentThreadResults({
        mailboxId,
        threadId: state.threadId,
        userId: alice.userId,
      });
      expect(ownResults.runs).toHaveLength(2);
      expect(
        ownResults.runs.every(
          (run) =>
            incomingRuns.some(
              (candidate) =>
                candidate.id === run.id &&
                candidate.actorUserId === alice.userId
            ) || run.id === manual[0]?.runId
        )
      ).toBeTruthy();
      const readerResults = await getMailAgentThreadResults({
        mailboxId,
        threadId: state.threadId,
        userId: reader.userId,
      });
      expect(readerResults.runs).toHaveLength(0);
      expect(readerResults).not.toHaveProperty("hasPrivateResults");
    });

    test("does not replay a legacy arrival when its invocation key differs", async () => {
      await activateBoth();
      const now = new Date();
      await db.insert(mailboxAgentRun).values({
        actorUserId: alice.userId,
        createdAt: now,
        id: crypto.randomUUID(),
        invocationKey: `received:${state.messageId}`,
        mailboxId,
        messageId: state.messageId,
        revisionId: revisions.get(alice.userId) ?? "",
        settingVersion: 2,
        status: "succeeded",
        threadId: state.threadId,
        triggerKind: "mail_received",
        updatedAt: now,
      });
      await enqueueMailAgentMessage({
        mailboxId,
        messageId: state.messageId,
        receivedAt: new Date(Date.now() + 1000),
        threadId: state.threadId,
      });
      const runs = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, mailboxId));
      expect(
        runs.filter((run) => run.actorUserId === alice.userId)
      ).toHaveLength(1);
      expect(runs.filter((run) => run.actorUserId === bob.userId)).toHaveLength(
        1
      );
    });

    test("pause during interpretation prevents admission of a queued write", async () => {
      await activateBoth();
      await enqueueManualMailAgentRun({
        invocationId: crypto.randomUUID(),
        mailboxId,
        threadId: state.threadId,
        userId: alice.userId,
      });
      state.beforeGenerate = async () => {
        await pauseMailAgent({ mailboxId, userId: alice.userId, version: 2 });
      };
      await drainMailAgentRuns({ limit: 1 });
      expect(state.linear).not.toHaveBeenCalled();
      const [run] = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, mailboxId));
      expect(run?.status).toBe("needs_attention");
      const otherState = await getMailAgentSettings({
        mailboxId,
        userId: bob.userId,
      });
      expect(otherState.setting.enabled).toBeTruthy();
    });

    test("leaving and rejoining cannot revive a personal action or its queued work", async () => {
      await activateBoth();
      const previousRevisionId = revisions.get(alice.userId);
      if (!previousRevisionId) {
        throw new Error("Missing original action review.");
      }
      await enqueueManualMailAgentRun({
        invocationId: crypto.randomUUID(),
        mailboxId,
        threadId: state.threadId,
        userId: alice.userId,
      });
      await db.delete(member).where(eq(member.id, alice.memberId));
      alice.memberId = crypto.randomUUID();
      const now = new Date();
      await db.insert(member).values({
        createdAt: now,
        id: alice.memberId,
        organizationId,
        role: "member",
        userId: alice.userId,
      });
      await db.insert(mailboxGrant).values({
        createdAt: now,
        id: crypto.randomUUID(),
        mailboxId,
        memberId: alice.memberId,
        role: "reader",
        updatedAt: now,
        userId: alice.userId,
      });
      const ownState = await getMailAgentSettings({
        mailboxId,
        userId: alice.userId,
      });
      expect(ownState.active).toBeNull();
      const freshRevisionId = await createAction(alice);
      await expect(
        activateMailAgent({
          acknowledgeAssumptions: true,
          mailboxId,
          revisionId: previousRevisionId,
          userId: alice.userId,
          version: 1,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await activateMailAgent({
        acknowledgeAssumptions: true,
        mailboxId,
        revisionId: freshRevisionId,
        userId: alice.userId,
        version: 1,
      });
      await drainMailAgentRuns({ limit: 1 });
      expect(state.linear).not.toHaveBeenCalled();
      const [run] = await db
        .select()
        .from(mailboxAgentRun)
        .where(eq(mailboxAgentRun.mailboxId, mailboxId));
      expect(run?.status).toBe("needs_attention");
    });

    test("a reader can run personal external changes but cannot activate a reply draft", async () => {
      await db
        .delete(mailboxPersonalAgentSetting)
        .where(
          and(
            eq(mailboxPersonalAgentSetting.mailboxId, mailboxId),
            eq(mailboxPersonalAgentSetting.userId, alice.userId)
          )
        );
      const revisionId = await createAction(alice, true);
      const settings = await getMailAgentSettings({
        mailboxId,
        userId: alice.userId,
      });
      expect(settings.draft?.canActivate).toBeFalsy();
      await expect(
        activateMailAgent({
          acknowledgeAssumptions: true,
          mailboxId,
          revisionId,
          userId: alice.userId,
          version: 1,
        })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    test("disconnect pauses only the owner's referencing action and reconnection does not resume it", async () => {
      await activateBoth();
      await expect(
        disconnectConnector({
          connectionId: bob.connectionId,
          provider: "linear",
          userId: alice.userId,
        })
      ).resolves.toMatchObject({ disconnected: false });
      await enqueueManualMailAgentRun({
        invocationId: crypto.randomUUID(),
        mailboxId,
        threadId: state.threadId,
        userId: alice.userId,
      });
      await disconnectConnector({
        connectionId: alice.connectionId,
        provider: "linear",
        userId: alice.userId,
      });
      const now = new Date();
      await db.insert(connectorCredential).values({
        createdAt: now,
        id: alice.connectionId,
        provider: "linear",
        providerAccountId: alice.connectionId,
        scopes: "read,write",
        updatedAt: now,
        userId: alice.userId,
      });
      const ownState = await getMailAgentSettings({
        mailboxId,
        userId: alice.userId,
      });
      const otherState = await getMailAgentSettings({
        mailboxId,
        userId: bob.userId,
      });
      expect(ownState.setting.enabled).toBeFalsy();
      expect(otherState.setting.enabled).toBeTruthy();
      await drainMailAgentRuns({ limit: 1 });
      expect(state.linear).not.toHaveBeenCalled();
    });
  }
);
