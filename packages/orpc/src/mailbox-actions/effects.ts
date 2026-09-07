import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { mailboxActionExternalEffect } from "@quieter/database/schema";
import type { ConnectorProvider } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { runConnectorAgentWriteCall } from "../connectors/agent-tools";
import type { ConnectorAgentToolCall } from "../connectors/agent-tools";
import { hashRequest } from "../request-hash";
import { withMailboxActionRun } from "./lease";

const effectResultSchema = z.object({
  durationMs: z.number(),
  externalId: z.string().optional(),
  externalUrl: z.string().optional(),
  output: z.unknown().optional(),
  status: z.literal("success"),
  toolName: z.string(),
});

export const runConnectorWriteCall = async (input: {
  attempts: number;
  actionId: string;
  call: ConnectorAgentToolCall;
  callIndex: number;
  credentialId: string;
  invocationPath: string[];
  nodeId: string;
  provider: ConnectorProvider;
  revisionId: string;
  runId: string;
  signal?: AbortSignal;
  stepRunId: string;
  userId: string;
}) => {
  input.signal?.throwIfAborted();
  const requestHash = hashRequest({
    call: input.call,
    credentialId: input.credentialId,
    provider: input.provider,
    userId: input.userId,
  });
  const idempotencyKey = `${input.runId}:${hashRequest(input.invocationPath)}:${input.callIndex}`;
  const keys = [
    idempotencyKey,
    `${input.runId}:${input.nodeId}:${input.callIndex}`,
  ];
  const claimed = await withMailboxActionRun(
    { attempts: input.attempts, id: input.runId },
    async (tx) => {
      const [existing] = await tx
        .select()
        .from(mailboxActionExternalEffect)
        .where(inArray(mailboxActionExternalEffect.idempotencyKey, keys))
        .limit(1);
      if (existing !== undefined) {
        if (
          existing.requestHash !== requestHash ||
          existing.status !== "succeeded"
        ) {
          throw new ORPCError("CONFLICT", {
            message:
              "This action may already have changed the connected app. Review its result before running it again.",
          });
        }
        return { ...effectResultSchema.parse(existing.result), replayed: true };
      }
      const id = randomUUID();
      const [created] = await tx
        .insert(mailboxActionExternalEffect)
        .values({
          actionId: input.actionId,
          connectorCredentialId: input.credentialId,
          createdAt: new Date(),
          id,
          idempotencyKey,
          input: input.call,
          metadata: { toolName: input.call.toolName },
          provider: input.provider,
          requestHash,
          revisionId: input.revisionId,
          runId: input.runId,
          status: "submitting",
          stepRunId: input.stepRunId,
        })
        .onConflictDoNothing()
        .returning({ id: mailboxActionExternalEffect.id });
      if (created === undefined) {
        throw new ORPCError("CONFLICT", {
          message: "This action is already being processed.",
        });
      }
      return created;
    }
  );
  if ("replayed" in claimed) {
    return claimed;
  }
  try {
    input.signal?.throwIfAborted();
    const result = await runConnectorAgentWriteCall({
      call: input.call,
      credentialId: input.credentialId,
      provider: input.provider,
      signal: input.signal,
      userId: input.userId,
    });
    if (result.status !== "success") {
      throw new Error(
        result.error ?? "The connected app did not confirm the change."
      );
    }
    const [saved] = await db
      .update(mailboxActionExternalEffect)
      .set({
        externalId: result.externalId ?? null,
        externalUrl: result.externalUrl ?? null,
        result,
        status: "succeeded",
      })
      .where(
        and(
          eq(mailboxActionExternalEffect.id, claimed.id),
          eq(mailboxActionExternalEffect.status, "submitting")
        )
      )
      .returning({ id: mailboxActionExternalEffect.id });
    if (saved === undefined) {
      throw new Error("The action result could not be saved.");
    }
    return { ...effectResultSchema.parse(result), replayed: false };
  } catch (error) {
    reportError(error, { operation: "mailbox-actions:external-effect" });
    await db
      .update(mailboxActionExternalEffect)
      .set({ status: "unknown" })
      .where(
        and(
          eq(mailboxActionExternalEffect.id, claimed.id),
          eq(mailboxActionExternalEffect.status, "submitting")
        )
      );
    throw new ORPCError("CONFLICT", {
      cause: error,
      message:
        "The connected app's result could not be confirmed. Review the action before running it again.",
    });
  }
};
