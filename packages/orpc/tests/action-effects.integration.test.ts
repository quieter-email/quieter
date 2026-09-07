import { db } from "@quieter/database/client";
import {
  connectorCredential,
  mailbox,
  mailboxAction,
  mailboxActionExternalEffect,
  mailboxActionRevision,
  mailboxActionRun,
  mailboxActionStepRun,
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

import type { runConnectorAgentWriteCall } from "../src/connectors/agent-tools";
import { runConnectorWriteCall } from "../src/mailbox-actions/effects";

const state = vi.hoisted(() => ({
  databaseUrl: process.env.MIGRATION_TEST_DATABASE_URL,
  write: vi.fn<typeof runConnectorAgentWriteCall>(),
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
        graph: { edges: [], nodes: [], version: 1 },
        id: revisionId,
        revisionNumber: 1,
      });
    });
    beforeEach(async () => {
      const now = new Date();
      const runId = crypto.randomUUID();
      const stepRunId = crypto.randomUUID();
      await db.insert(mailboxActionRun).values({
        actionId,
        createdAt: now,
        dedupeKey: runId,
        id: runId,
        mailboxId,
        organizationId,
        revisionId,
        sourceMessageId: "fixture",
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
    });

    afterAll(async () => {
      await db.delete(organization).where(eq(organization.id, organizationId));
      await db.delete(user).where(eq(user.id, userId));
      await db.$client.end();
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
