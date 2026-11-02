import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  mailbox,
  organization,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";

import { AiCreditAdmissionBusyError } from "./ai-credit-errors";
import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import {
  getBillingCreditUsage,
  getBillingUsagePeriodEnd,
  recordBillingCreditUsage,
} from "./credits.ts";
import type { BillingUsageKind } from "./credits.ts";
import { hasUserBillingFeature } from "./entitlements.ts";
import type { BillingAccount } from "./entitlements.ts";

export type AiBillingContext =
  | { kind: "development" }
  | {
      kind: "team";
      account: BillingAccount | null;
      admittedAt: Date;
      groupId: string;
      organizationId: string;
      usageKind: BillingUsageKind;
    };

export const createMailboxAiBillingContext = async (input: {
  externalId: string;
  mailboxId: string;
  usageKind: BillingUsageKind;
  userId: string;
}): Promise<Extract<AiBillingContext, { kind: "team" }>> => {
  const [row] = await db
    .select({ organizationId: mailbox.organizationId })
    .from(mailbox)
    .where(eq(mailbox.id, input.mailboxId))
    .limit(1);
  if (row === undefined) {
    throw new ORPCError("FORBIDDEN", {
      message: "This mailbox is no longer available.",
    });
  }
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: row.organizationId,
    userId: input.userId,
  });
  if (
    !entitlement.hasAccess ||
    (!entitlement.hasUnlimitedAccess && entitlement.account === null)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "AI features require available usage balance.",
    });
  }
  return {
    account: entitlement.hasUnlimitedAccess ? null : entitlement.account,
    admittedAt: new Date(),
    groupId: input.externalId,
    kind: "team",
    organizationId: row.organizationId,
    usageKind: input.usageKind,
  };
};

export const getOutstandingAiCreditReservations = async (
  account: BillingAccount,
  client: Pick<typeof db, "select"> = db
) => {
  const [reserved] = await client
    .select({
      cost: sql`coalesce(${sum(aiCreditReservation.reservedCostMicroCents)}, 0)`.mapWith(
        Number
      ),
    })
    .from(aiCreditReservation)
    .where(
      and(
        eq(aiCreditReservation.organizationId, account.organizationId),
        eq(aiCreditReservation.status, "reserved")
      )
    );
  return reserved?.cost ?? 0;
};

export const reserveAiCreditUsage = async (context: AiBillingContext) => {
  if (context.kind === "development") {
    if (serverEnv.QUIETER_DEPLOYMENT_ENV !== "local") {
      throw new Error(
        "Development AI billing is available only in local execution."
      );
    }
    return null;
  }
  const { account } = context;
  if (account === null) {
    await db.insert(aiCreditReservation).values({
      account: null,
      createdAt: context.admittedAt,
      groupId: context.groupId,
      id: crypto.randomUUID(),
      organizationId: context.organizationId,
      reservedCostMicroCents: 0,
      status: "settled",
      usageKind: context.usageKind,
    });
    return null;
  }
  return await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, account.organizationId))
      .for("update");
    const usage = await getBillingCreditUsage(account, tx);
    const aiReserved = await getOutstandingAiCreditReservations(account, tx);
    const [mailReserved] = await tx
      .select({
        cost: sql`coalesce(${sum(organizationMailSendIdempotency.estimatedCostMicroCents)}, 0)`.mapWith(
          Number
        ),
      })
      .from(organizationMailSendIdempotency)
      .leftJoin(
        billingCreditUsageEvent,
        eq(
          billingCreditUsageEvent.dedupeKey,
          sql`'mail:outbound:' || ${organizationMailSendIdempotency.organizationId} || ':' || (${organizationMailSendIdempotency.response}->>'messageId')`
        )
      )
      .where(
        and(
          eq(
            organizationMailSendIdempotency.organizationId,
            account.organizationId
          ),
          inArray(organizationMailSendIdempotency.status, [
            "prepared",
            "submitting",
            "accepted",
            "unknown",
          ]),
          gte(
            organizationMailSendIdempotency.createdAt,
            account.currentPeriodStart
          ),
          lt(
            organizationMailSendIdempotency.createdAt,
            getBillingUsagePeriodEnd(account, tx)
          ),
          isNull(billingCreditUsageEvent.id)
        )
      );
    const available =
      usage.creditAmountMicroCents -
      usage.costMicroCents -
      (mailReserved?.cost ?? 0);
    // These endpoints have no monetary cap. Holding the remaining balance
    // preserves single-call admission while preventing concurrent reuse.
    if (available <= 0) {
      throw new ORPCError("FORBIDDEN", {
        message:
          "AI features require available usage balance. Try again after the current request finishes.",
      });
    }
    if (aiReserved > 0) {
      throw new AiCreditAdmissionBusyError();
    }
    const id = crypto.randomUUID();
    await tx.insert(aiCreditReservation).values({
      account: {
        ...account,
        currentPeriodEnd: account.currentPeriodEnd.toISOString(),
        currentPeriodStart: account.currentPeriodStart.toISOString(),
      },
      createdAt: context.admittedAt,
      groupId: context.groupId,
      id,
      organizationId: account.organizationId,
      reservedCostMicroCents: available,
      status: "reserved",
      usageKind: context.usageKind,
    });
    return id;
  });
};

export const recordAiCreditProviderGeneration = async (input: {
  reservationId: string | null;
  generationId: string | undefined;
}) => {
  if (input.reservationId === null || input.generationId === undefined) {
    return;
  }
  await db
    .update(aiCreditReservation)
    .set({ providerGenerationId: input.generationId })
    .where(
      and(
        eq(aiCreditReservation.id, input.reservationId),
        isNull(aiCreditReservation.providerGenerationId)
      )
    );
};

const generationCostSchema = z.object({
  data: z.object({
    finish_reason: z.string().min(1),
    id: z.string(),
    total_cost: z.number().nonnegative(),
  }),
});

export const reconcileAiCreditReservations = async (
  input: { limit?: number; reservationId?: string } = {}
) => {
  const apiKey = serverEnv.OPENROUTER_API_KEY;
  if (apiKey && input.reservationId === undefined) {
    const unknown = await db.transaction(async (transaction) => {
      const rows = await transaction
        .select()
        .from(aiCreditReservation)
        .where(
          and(
            eq(aiCreditReservation.status, "reserved"),
            isNull(aiCreditReservation.actualCostMicroCents),
            isNotNull(aiCreditReservation.providerGenerationId)
          )
        )
        .orderBy(
          sql`${aiCreditReservation.lastReconciledAt} asc nulls first`,
          aiCreditReservation.id
        )
        .limit(input.limit ?? 100)
        .for("update", { skipLocked: true });
      if (rows.length > 0) {
        // Commit retry order before provider I/O, including unavailable outcomes.
        await transaction
          .update(aiCreditReservation)
          .set({ lastReconciledAt: sql`clock_timestamp()` })
          .where(
            inArray(
              aiCreditReservation.id,
              rows.map((row) => row.id)
            )
          );
      }
      return rows;
    });
    for (const row of unknown) {
      if (row.providerGenerationId === null) {
        continue;
      }
      try {
        const url = new URL("https://openrouter.ai/api/v1/generation");
        url.searchParams.set("id", row.providerGenerationId);
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) {
          continue;
        }
        const result = generationCostSchema.safeParse(await response.json());
        if (
          result.success &&
          result.data.data.id === row.providerGenerationId
        ) {
          await db
            .update(aiCreditReservation)
            .set({
              actualCostMicroCents:
                result.data.data.total_cost === 0
                  ? 0
                  : getAiUsageCostMicroCents(result.data.data.total_cost),
            })
            .where(
              and(
                eq(aiCreditReservation.id, row.id),
                eq(aiCreditReservation.status, "reserved"),
                isNull(aiCreditReservation.actualCostMicroCents)
              )
            );
        }
      } catch (error) {
        reportError(error, { operation: "billing:reconcile-ai-generation" });
      }
    }
  }
  const rows = await db
    .select()
    .from(aiCreditReservation)
    .where(
      and(
        eq(aiCreditReservation.status, "reserved"),
        isNotNull(aiCreditReservation.actualCostMicroCents),
        input.reservationId === undefined
          ? undefined
          : eq(aiCreditReservation.id, input.reservationId)
      )
    )
    .limit(input.limit ?? 100);
  for (const row of rows) {
    if (row.account === null || row.actualCostMicroCents === null) {
      throw new Error("The AI billing reservation is incomplete.");
    }
    const account: BillingAccount = {
      ...row.account,
      currentPeriodEnd: new Date(row.account.currentPeriodEnd),
      currentPeriodStart: new Date(row.account.currentPeriodStart),
    };
    const usage = {
      account,
      aiReservationId: row.id,
      category: "ai",
      costMicroCents: row.actualCostMicroCents,
      createdAt: row.createdAt,
      dedupeKey: `ai:reservation:${row.id}`,
      metadata: { usageKind: row.usageKind },
    } satisfies Parameters<typeof recordBillingCreditUsage>[0];
    if (input.reservationId === undefined) {
      // Recovered usage must pass subscription eligibility in the reporting sync.
      await db.transaction(
        async (transaction) =>
          await recordBillingCreditUsage(usage, transaction)
      );
    } else {
      await recordBillingCreditUsage(usage);
    }
  }
  return rows.length;
};

export const settleAiCreditUsage = async (input: {
  costUsd: number;
  reservationId: string | null;
}) => {
  if (input.reservationId === null) {
    return;
  }
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) {
    throw new Error("AI provider cost must be finite and nonnegative.");
  }
  const { reservationId } = input;
  await db
    .update(aiCreditReservation)
    .set({
      actualCostMicroCents:
        input.costUsd === 0 ? 0 : getAiUsageCostMicroCents(input.costUsd),
    })
    .where(
      and(
        eq(aiCreditReservation.id, reservationId),
        eq(aiCreditReservation.status, "reserved"),
        isNull(aiCreditReservation.actualCostMicroCents)
      )
    );
  const [row] = await db
    .select({ status: aiCreditReservation.status })
    .from(aiCreditReservation)
    .where(eq(aiCreditReservation.id, reservationId))
    .limit(1);
  if (row === undefined || row.status === "released") {
    throw new Error("The AI billing reservation is unavailable.");
  }
  await reconcileAiCreditReservations({ reservationId });
};

export const releaseAiCreditUsage = async (reservationId: string | null) => {
  if (reservationId === null) {
    return;
  }
  const [row] = await db
    .select({ organizationId: aiCreditReservation.organizationId })
    .from(aiCreditReservation)
    .where(eq(aiCreditReservation.id, reservationId))
    .limit(1);
  if (row === undefined) {
    throw new Error("The AI billing reservation is unavailable.");
  }
  await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, row.organizationId))
      .for("update");
    await tx
      .update(aiCreditReservation)
      .set({ status: "released" })
      .where(
        and(
          eq(aiCreditReservation.id, reservationId),
          eq(aiCreditReservation.status, "reserved"),
          isNull(aiCreditReservation.actualCostMicroCents)
        )
      );
  });
};

export const hasAiCreditReservationGroup = async (groupId: string) => {
  const [row] = await db
    .select({ id: aiCreditReservation.id })
    .from(aiCreditReservation)
    .where(
      inArray(
        aiCreditReservation.groupId,
        groupId
          .split(":")
          .map((_, index, parts) => parts.slice(0, index + 1).join(":"))
      )
    )
    .limit(1);
  return row !== undefined;
};
