import type { evaluateMailboxActionCondition } from "@quieter/ai/mailbox-actions";
import { db } from "@quieter/database/client";
import {
  connectorCredential,
  mailbox,
  mailboxAction,
  mailboxActionExternalEffect,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionStepRun,
  managedMailMessage,
  organization,
  user,
} from "@quieter/database/schema";
import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from "vite-plus/test";

import type { loadAiAgentContext } from "../src/ai-memory";
import type { runConnectorAgentWriteCall } from "../src/connectors/agent-tools";
import { runConnectorWriteCall } from "../src/mailbox-actions/effects";
import { executeMailboxActionRun } from "../src/mailbox-actions/executor";
import { claimMailboxActionRun } from "../src/mailbox-actions/lease";

const state = vi.hoisted(() => ({
  condition: vi.fn<typeof evaluateMailboxActionCondition>(),
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  write: vi.fn<typeof runConnectorAgentWriteCall>(),
}));
vi.mock(import("@quieter/ai/mailbox-actions"), async (original) => ({
  ...(await original()),
  evaluateMailboxActionCondition: state.condition,
}));
vi.mock(import("../src/ai-memory"), async (original) => ({
  ...(await original()),
  loadAiAgentContext: vi
    .fn<typeof loadAiAgentContext>()
    .mockResolvedValue({ instructions: null, memory: null }),
}));
vi.mock(import("@quieter/env/server"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    serverEnv: {
      ...actual.serverEnv,
      DATABASE_URL: state.databaseUrl,
      QUIETER_DEPLOYMENT_ENV: "local" as const,
    },
  };
});
vi.mock(import("../src/connectors/agent-tools"), () => ({
  runConnectorAgentWriteCall: state.write,
}));

describe.skipIf(state.databaseUrl === undefined)(
  "action effects on PostgreSQL",
  () => {
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const credentialId = crypto.randomUUID();
    const mailboxId = crypto.randomUUID();
    const actionId = crypto.randomUUID();
    const revisionId = crypto.randomUUID();
    let input: Parameters<typeof runConnectorWriteCall>[0];
    beforeAll(async () => {
      const url = new URL(state.databaseUrl ?? "");
      if (
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/quieter_migration_test"
      ) {
        throw new Error(
          "Action integration tests require loopback quieter_migration_test."
        );
      }
      const now = new Date();
      await db.insert(user).values({
        createdAt: now,
        email: `${userId}@example.com`,
        emailVerified: true,
        id: userId,
        name: "Action test",
        updatedAt: now,
      });
      await db.insert(organization).values({
        createdAt: now,
        id: organizationId,
        name: "Action test",
        slug: organizationId,
      });
      await db.insert(mailbox).values({
        createdAt: now,
        emailAddress: `${mailboxId}@example.com`,
        id: mailboxId,
        organizationId,
        provider: "managed",
        updatedAt: now,
      });
      await db.insert(connectorCredential).values({
        createdAt: now,
        id: credentialId,
        provider: "linear",
        providerAccountId: "fixture",
        scopes: "write",
        updatedAt: now,
        userId,
      });
      await db.insert(mailboxAction).values({
        createdAt: now,
        createdByUserId: userId,
        id: actionId,
        mailboxId,
        name: "Action",
        organizationId,
        updatedAt: now,
      });
      await db.insert(mailboxActionRevision).values({
        actionId,
        createdAt: now,
        createdByUserId: userId,
        graph: {
          edges: [
            {
              id: "edge-1",
              source: "trigger",
              sourcePort: "out",
              target: "first",
              targetPort: "in",
            },
            {
              id: "edge-2",
              source: "first",
              sourcePort: "yes",
              target: "second",
              targetPort: "in",
            },
            {
              id: "edge-3",
              source: "second",
              sourcePort: "yes",
              target: "stop",
              targetPort: "in",
            },
          ],
          nodes: [
            {
              config: {},
              id: "trigger",
              position: { x: 0, y: 0 },
              type: "email_received",
            },
            {
              config: { criteria: "First" },
              id: "first",
              position: { x: 1, y: 0 },
              type: "ai_condition",
            },
            {
              config: { criteria: "Second" },
              id: "second",
              position: { x: 2, y: 0 },
              type: "ai_condition",
            },
            { config: {}, id: "stop", position: { x: 3, y: 0 }, type: "stop" },
          ],
          version: 1,
        },
        id: revisionId,
        revisionNumber: 1,
      });
      await db.insert(managedMailMessage).values({
        createdAt: now,
        direction: "inbound",
        from: "sender@example.com",
        id: crypto.randomUUID(),
        mailboxId,
        providerMessageId: "fixture",
        sentAt: now,
        threadId: "fixture",
        updatedAt: now,
      });
    });
    beforeEach(async () => {
      const now = new Date();
      const runId = crypto.randomUUID();
      const stepRunId = crypto.randomUUID();
      await db.insert(mailboxActionRun).values({
        actionId,
        attempts: 1,
        createdAt: now,
        dedupeKey: runId,
        id: runId,
        leasedUntil: new Date(Date.now() + 90_000),
        mailboxId,
        organizationId,
        revisionId,
        sourceMessageId: "fixture",
        status: "running",
        triggerNodeId: "trigger",
        updatedAt: now,
      });
      await db.insert(mailboxActionStepRun).values({
        createdAt: now,
        id: stepRunId,
        nodeId: "connector",
        nodeType: "connector_agent",
        runId,
        updatedAt: now,
      });
      input = {
        actionId,
        attempts: 1,
        call: { arguments: { title: "First" }, toolName: "create_issue" },
        callIndex: 0,
        credentialId,
        invocationPath: ["trigger", "edge-1", "connector"],
        nodeId: "connector",
        provider: "linear",
        revisionId,
        runId,
        stepRunId,
        userId,
      };
      state.write.mockReset().mockResolvedValue({
        durationMs: 1,
        output: { title: "Created" },
        status: "success",
        toolName: "create_issue",
      });
      state.condition.mockReset().mockResolvedValue({
        confidence: 1,
        evidence: [],
        matches: true,
        rationale: "Matched",
      });
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
    });

    test("a replaced worker cannot make another external change or finish its replacement's run", async () => {
      await db
        .update(mailboxActionRun)
        .set({ leasedUntil: null, status: "queued" })
        .where(eq(mailboxActionRun.id, input.runId));
      state.condition.mockImplementationOnce(async () => {
        await db
          .update(mailboxActionRun)
          .set({ leasedUntil: new Date(0) })
          .where(eq(mailboxActionRun.id, input.runId));
        await claimMailboxActionRun(input.runId);
        return {
          confidence: 1,
          evidence: [],
          matches: true,
          rationale: "Late result",
        };
      });
      await expect(executeMailboxActionRun(input.runId)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(
        runConnectorWriteCall({ ...input, attempts: 2 })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const [run] = await db
        .select()
        .from(mailboxActionRun)
        .where(eq(mailboxActionRun.id, input.runId));
      expect(run).toMatchObject({
        attempts: 3,
        completedAt: null,
        status: "running",
      });
      expect(state.condition).toHaveBeenCalledOnce();
      expect(state.write).not.toHaveBeenCalled();
    });

    test("retry reuses completed decisions and continues with the failed step", async () => {
      await db
        .update(mailboxActionRun)
        .set({ leasedUntil: null, status: "queued" })
        .where(eq(mailboxActionRun.id, input.runId));
      state.condition
        .mockResolvedValueOnce({
          confidence: 1,
          evidence: [],
          matches: true,
          rationale: "Matched",
        })
        .mockRejectedValueOnce(new Error("Temporary model failure"));
      await expect(executeMailboxActionRun(input.runId)).rejects.toThrow(
        "Temporary model failure"
      );
      await expect(executeMailboxActionRun(input.runId)).resolves.toStrictEqual(
        {
          status: "succeeded",
        }
      );
      expect(
        state.condition.mock.calls.map(([call]) => call.criteria)
      ).toStrictEqual(["First", "Second", "Second"]);
    });

    test("crashed deliveries cannot restart indefinitely after their retry budget is spent", async () => {
      await db
        .update(mailboxActionRun)
        .set({ attempts: 6, leasedUntil: new Date(0) })
        .where(eq(mailboxActionRun.id, input.runId));
      await expect(executeMailboxActionRun(input.runId)).resolves.toStrictEqual(
        {
          status: "not_claimed",
        }
      );
      const [run] = await db
        .select()
        .from(mailboxActionRun)
        .where(eq(mailboxActionRun.id, input.runId));
      expect(run.status).toBe("failed");
      expect(state.condition).not.toHaveBeenCalled();
    });

    test("concurrent calls perform one write and replay successful results without an external ID", async () => {
      const results = await Promise.allSettled([
        runConnectorWriteCall(input),
        runConnectorWriteCall(input),
      ]);
      expect(
        results.some((result) => result.status === "fulfilled")
      ).toBeTruthy();
      expect(state.write).toHaveBeenCalledOnce();
      await expect(runConnectorWriteCall(input)).resolves.toMatchObject({
        output: { title: "Created" },
        replayed: true,
        status: "success",
      });
      expect(state.write).toHaveBeenCalledOnce();
    });

    test("a lost result is retained as unknown and cannot execute again", async () => {
      state.write.mockRejectedValueOnce(
        new Error("Response lost after the external write")
      );
      await expect(runConnectorWriteCall(input)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await expect(runConnectorWriteCall(input)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(state.write).toHaveBeenCalledOnce();
      const [effect] = await db
        .select()
        .from(mailboxActionExternalEffect)
        .where(eq(mailboxActionExternalEffect.runId, input.runId));
      expect(effect?.status).toBe("unknown");
    });

    test("changed generated arguments cannot reuse the previous call's result", async () => {
      await runConnectorWriteCall(input);
      await expect(
        runConnectorWriteCall({
          ...input,
          call: { ...input.call, arguments: { title: "Different" } },
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(state.write).toHaveBeenCalledOnce();
    });

    test("separate branch invocations can each perform their intended write", async () => {
      await runConnectorWriteCall(input);
      await runConnectorWriteCall({
        ...input,
        invocationPath: ["trigger", "edge-2", "connector"],
      });
      expect(state.write).toHaveBeenCalledTimes(2);
    });

    test("legacy effects without a saved plan require review instead of silently replaying", async () => {
      await db.insert(mailboxActionExternalEffect).values({
        actionId,
        createdAt: new Date(),
        externalId: "legacy-issue",
        id: crypto.randomUUID(),
        idempotencyKey: `${input.runId}:${input.nodeId}:${input.callIndex}`,
        provider: "linear",
        revisionId,
        runId: input.runId,
      });
      await expect(runConnectorWriteCall(input)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(state.write).not.toHaveBeenCalled();
    });
  }
);
