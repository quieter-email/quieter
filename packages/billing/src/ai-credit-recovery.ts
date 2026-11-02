import { createHash } from "node:crypto";

import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  organization,
} from "@quieter/database/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import { recordBillingCreditUsage } from "./credits.ts";

const identity = {
  organizationId: z.string().min(1).max(200),
  reservationId: z.uuid(),
};
const reference = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_:/#.-]{2,199}$/u);
const resolution = z.discriminatedUnion("kind", [
  z.strictObject({
    costUsd: z.number().nonnegative(),
    kind: z.literal("actual-cost"),
  }),
  z.strictObject({ kind: z.literal("non-execution") }),
]);
const decision = {
  ...identity,
  evidence: reference,
  expectedSnapshot: z.string().regex(/^[a-f0-9]{64}$/u),
  operator: reference,
  reason: reference,
  resolution,
};
export const aiCreditRecoveryCommandSchema = z.discriminatedUnion("mode", [
  z.strictObject({ ...identity, mode: z.literal("inspect") }),
  z.strictObject({ ...decision, mode: z.literal("dry-run") }),
  z.strictObject({
    ...decision,
    confirmation: z.string().min(1),
    mode: z.literal("resolve"),
  }),
]);
type Reservation = typeof aiCreditReservation.$inferSelect;

const snapshot = (row: Reservation) =>
  createHash("sha256")
    .update(
      JSON.stringify({
        account: row.account,
        actualCostMicroCents: row.actualCostMicroCents,
        createdAt: row.createdAt.toISOString(),
        groupId: row.groupId,
        id: row.id,
        organizationId: row.organizationId,
        providerGenerationId: row.providerGenerationId,
        reservedCostMicroCents: row.reservedCostMicroCents,
        status: row.status,
        usageKind: row.usageKind,
      })
    )
    .digest("hex");

const readReservation = async (
  input: z.infer<typeof aiCreditRecoveryCommandSchema>,
  client: DatabaseExecutor
) => {
  const [row] = await client
    .select()
    .from(aiCreditReservation)
    .where(
      and(
        eq(aiCreditReservation.id, input.reservationId),
        eq(aiCreditReservation.organizationId, input.organizationId)
      )
    )
    .for("update");
  if (
    row === undefined ||
    row.account === null ||
    row.account.organizationId !== row.organizationId
  ) {
    throw new Error(
      "The reservation identity or authorizing account is unavailable."
    );
  }
  return row;
};

export const runAiCreditRecovery = async (raw: unknown) => {
  const input = aiCreditRecoveryCommandSchema.parse(raw);
  if (input.mode === "inspect") {
    const row = await readReservation(input, db);
    return {
      actualCostMicroCents: row.actualCostMicroCents,
      admittedAt: row.createdAt.toISOString(),
      hasProviderIdentity: row.providerGenerationId !== null,
      periodEnd: row.account?.currentPeriodEnd,
      periodStart: row.account?.currentPeriodStart,
      reservationId: row.id,
      reservedCostMicroCents: row.reservedCostMicroCents,
      snapshot: snapshot(row),
      status: row.status,
    };
  }
  if (
    input.mode === "resolve" &&
    input.confirmation !==
      `resolve:${input.reservationId}:${input.expectedSnapshot}`
  ) {
    throw new Error(
      "Explicit reservation and snapshot confirmation is required."
    );
  }
  const costMicroCents =
    input.resolution.kind === "actual-cost" && input.resolution.costUsd > 0
      ? getAiUsageCostMicroCents(input.resolution.costUsd)
      : 0;
  if (!Number.isSafeInteger(costMicroCents)) {
    throw new TypeError(
      "The resolved cost is outside the supported monetary range."
    );
  }
  return await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    const row = await readReservation(input, tx);
    const [previous] = await tx
      .select()
      .from(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.dedupeKey, `ai:reservation:${row.id}`));
    const targetStatus =
      input.resolution.kind === "actual-cost" ? "settled" : "released";
    const audit = {
      recoveryEvidence: input.evidence,
      recoveryOperator: input.operator,
      recoveryReason: input.reason,
      recoveryResolution: input.resolution.kind,
      recoveryResultSnapshot: snapshot({
        ...row,
        actualCostMicroCents:
          input.resolution.kind === "actual-cost" ? costMicroCents : null,
        status: targetStatus,
      }),
      recoverySnapshot: input.expectedSnapshot,
      usageKind: row.usageKind,
    };
    if (
      snapshot(row) === previous?.metadata?.recoveryResultSnapshot &&
      row.status === targetStatus &&
      previous?.costMicroCents === costMicroCents &&
      Object.entries(audit).every(
        ([key, value]) => previous.metadata?.[key] === value
      )
    ) {
      return { outcome: "already-resolved", status: row.status };
    }
    if (
      snapshot(row) !== input.expectedSnapshot ||
      row.status !== "reserved" ||
      previous !== undefined
    ) {
      throw new Error(
        "The reservation changed. Inspect it again before recovery."
      );
    }
    if (
      row.actualCostMicroCents !== null &&
      (input.resolution.kind !== "actual-cost" ||
        row.actualCostMicroCents !== costMicroCents)
    ) {
      throw new Error("The resolution conflicts with persisted provider cost.");
    }
    if (
      input.resolution.kind === "non-execution" &&
      row.providerGenerationId !== null
    ) {
      throw new Error(
        "A provider identity cannot be resolved as non-execution."
      );
    }
    if (input.mode === "dry-run") {
      return { costMicroCents, outcome: "dry-run", status: targetStatus };
    }
    if (row.account === null) {
      throw new Error("The authorizing account is unavailable.");
    }
    await recordBillingCreditUsage(
      {
        account: {
          ...row.account,
          currentPeriodEnd: new Date(row.account.currentPeriodEnd),
          currentPeriodStart: new Date(row.account.currentPeriodStart),
        },
        aiReservationId:
          input.resolution.kind === "actual-cost" ? row.id : undefined,
        category: "ai",
        costMicroCents,
        createdAt: row.createdAt,
        dedupeKey: `ai:reservation:${row.id}`,
        metadata: audit,
      },
      tx
    );
    await tx
      .update(aiCreditReservation)
      .set({
        actualCostMicroCents:
          input.resolution.kind === "actual-cost" ? costMicroCents : null,
        status: targetStatus,
      })
      .where(eq(aiCreditReservation.id, row.id));
    return { costMicroCents, outcome: "resolved", status: targetStatus };
  });
};
