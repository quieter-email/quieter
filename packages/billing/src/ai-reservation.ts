import { ORPCError } from "@orpc/server";
import type { DatabaseTransaction } from "@quieter/database/client";
import { db } from "@quieter/database/client";
import { aiCreditReservation, mailbox } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, eq, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm";
import { z } from "zod";

import { AiCreditAdmissionBusyError } from "./ai-credit-errors.ts";
import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import { assertBillingMoney, getBillingBudget } from "./budget.ts";
import { lockBillingAccount, recordBillingCreditUsage } from "./credits.ts";
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
        account.scope === "account" && account.billingOwnerUserId !== undefined
          ? eq(aiCreditReservation.billingUserId, account.billingOwnerUserId)
          : and(
              eq(aiCreditReservation.organizationId, account.organizationId),
              sql`coalesce(${aiCreditReservation.account}->>'scope', 'team') = 'team'`
            ),
        eq(aiCreditReservation.status, "reserved")
      )
    );
  assertBillingMoney(reserved?.cost ?? 0);
  return reserved?.cost ?? 0;
};

export const reserveAiCreditUsage = async (
  context: AiBillingContext,
  maximumCostUsd?: number
) => {
  const maximumCostMicroCents =
    maximumCostUsd === undefined
      ? undefined
      : getAiUsageCostMicroCents(maximumCostUsd);
  if (maximumCostMicroCents !== undefined) {
    assertBillingMoney(maximumCostMicroCents);
  }
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
    const id = crypto.randomUUID();
    await db.insert(aiCreditReservation).values({
      account: null,
      createdAt: context.admittedAt,
      groupId: context.groupId,
      id,
      organizationId: context.organizationId,
      reservedCostMicroCents: 0,
      status: "settled",
      usageKind: context.usageKind,
    });
    return id;
  }
  return await db.transaction(async (tx) => {
    await lockBillingAccount(account, tx, { admission: true });
    const budget = await getBillingBudget(account, tx);
    const [openReservation] = await tx
      .select({
        createdAt: aiCreditReservation.createdAt,
        id: aiCreditReservation.id,
      })
      .from(aiCreditReservation)
      .where(
        and(
          account.scope === "account" &&
            account.billingOwnerUserId !== undefined
            ? eq(aiCreditReservation.billingUserId, account.billingOwnerUserId)
            : eq(aiCreditReservation.organizationId, account.organizationId),
          eq(aiCreditReservation.status, "reserved")
        )
      )
      .orderBy(aiCreditReservation.createdAt)
      .limit(1);
    if (
      openReservation !== undefined &&
      (maximumCostMicroCents === undefined ||
        budget.authorizedCostMicroCents === 0 ||
        openReservation.createdAt < account.currentPeriodStart ||
        openReservation.createdAt >= account.currentPeriodEnd)
    ) {
      throw new AiCreditAdmissionBusyError();
    }
    if (budget.authorizedCostMicroCents === 0) {
      throw new ORPCError("FORBIDDEN", {
        message: "AI features require available usage balance.",
      });
    }
    if (
      maximumCostMicroCents !== undefined &&
      maximumCostMicroCents >
        (budget.authorizedCostMicroCents ??
          Number.MAX_SAFE_INTEGER - budget.pendingMicroCents) &&
      openReservation !== undefined
    ) {
      throw new AiCreditAdmissionBusyError();
    }
    const reservedCostMicroCents = Math.min(
      maximumCostMicroCents ?? Number.MAX_SAFE_INTEGER,
      budget.authorizedCostMicroCents ??
        Number.MAX_SAFE_INTEGER - budget.pendingMicroCents
    );
    const id = crypto.randomUUID();
    await tx.insert(aiCreditReservation).values({
      account: {
        ...account,
        authorizedCostMicroCents:
          maximumCostMicroCents === undefined
            ? budget.authorizedCostMicroCents
            : reservedCostMicroCents,
        currentPeriodEnd: account.currentPeriodEnd.toISOString(),
        currentPeriodStart: account.currentPeriodStart.toISOString(),
      },
      billingUserId: account.billingOwnerUserId ?? null,
      createdAt: context.admittedAt,
      groupId: context.groupId,
      id,
      organizationId: account.organizationId,
      reservedCostMicroCents,
      status: "reserved",
      usageKind: context.usageKind,
    });
    return id;
  });
};

const withLockedAiReservation = async <T>(
  reservationId: string,
  action: (
    row: typeof aiCreditReservation.$inferSelect,
    tx: DatabaseTransaction
  ) => Promise<T>
) => {
  const [identity] = await db
    .select()
    .from(aiCreditReservation)
    .where(eq(aiCreditReservation.id, reservationId))
    .limit(1);
  if (identity === undefined) {
    throw new Error("The AI billing reservation is unavailable.");
  }
  return await db.transaction(async (tx) => {
    await lockBillingAccount(
      {
        billingOwnerUserId:
          identity.account?.billingOwnerUserId ??
          identity.billingUserId ??
          undefined,
        organizationId: identity.organizationId,
        scope: identity.account?.scope,
      },
      tx
    );
    const [row] = await tx
      .select()
      .from(aiCreditReservation)
      .where(eq(aiCreditReservation.id, reservationId))
      .for("update");
    if (
      row === undefined ||
      (row.account?.billingOwnerUserId ?? row.billingUserId) !==
        (identity.account?.billingOwnerUserId ?? identity.billingUserId)
    ) {
      throw new Error("The AI billing reservation changed. Please try again.");
    }
    return await action(row, tx);
  });
};

export const recordAiCreditProviderGeneration = async (input: {
  reservationId: string | null;
  generationId: string | undefined;
}) => {
  if (input.reservationId === null || input.generationId === undefined) {
    return;
  }
  const { reservationId } = input;
  const [row] = await db
    .update(aiCreditReservation)
    .set({
      providerGenerationId: sql`coalesce(${aiCreditReservation.providerGenerationId}, ${input.generationId})`,
    })
    .where(eq(aiCreditReservation.id, reservationId))
    .returning({ id: aiCreditReservation.id });
  if (row === undefined) {
    throw new Error("The AI billing reservation is unavailable.");
  }
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
    const unknown = await db
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
      .limit(input.limit ?? 100);
    for (const row of unknown) {
      if (row.providerGenerationId === null) {
        continue;
      }
      try {
        const eligible = await withLockedAiReservation(
          row.id,
          async (current, tx) => {
            if (
              current.status !== "reserved" ||
              current.actualCostMicroCents !== null ||
              current.lastReconciledAt?.getTime() !==
                row.lastReconciledAt?.getTime()
            ) {
              return false;
            }
            await tx
              .update(aiCreditReservation)
              .set({ lastReconciledAt: sql`clock_timestamp()` })
              .where(eq(aiCreditReservation.id, row.id));
            return true;
          }
        );
        if (!eligible) {
          continue;
        }
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
          const actualCostMicroCents =
            result.data.data.total_cost === 0
              ? 0
              : getAiUsageCostMicroCents(result.data.data.total_cost);
          assertBillingMoney(actualCostMicroCents);
          await withLockedAiReservation(row.id, async (_current, tx) => {
            await tx
              .update(aiCreditReservation)
              .set({
                actualCostMicroCents,
              })
              .where(
                and(
                  eq(aiCreditReservation.id, row.id),
                  eq(aiCreditReservation.status, "reserved"),
                  isNull(aiCreditReservation.actualCostMicroCents)
                )
              );
          });
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
      billingOwnerUserId:
        row.account.billingOwnerUserId ?? row.billingUserId ?? undefined,
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
  billing: AiBillingContext;
  costUsd: number;
  reservationId: string | null;
}) => {
  if (input.reservationId === null) {
    return;
  }
  if (!Number.isFinite(input.costUsd) || input.costUsd < 0) {
    throw new Error("AI provider cost must be finite and nonnegative.");
  }
  const actualCostMicroCents =
    input.costUsd === 0 ? 0 : getAiUsageCostMicroCents(input.costUsd);
  assertBillingMoney(actualCostMicroCents);
  const { reservationId } = input;
  if (input.billing.kind === "team" && input.billing.account === null) {
    const [row] = await db
      .update(aiCreditReservation)
      .set({
        actualCostMicroCents: sql`coalesce(${aiCreditReservation.actualCostMicroCents}, ${actualCostMicroCents})`,
      })
      .where(
        and(
          eq(aiCreditReservation.id, reservationId),
          isNull(aiCreditReservation.account),
          eq(aiCreditReservation.status, "settled")
        )
      )
      .returning({ id: aiCreditReservation.id });
    if (row !== undefined) {
      return;
    }
  }
  const hasBillingAccount = await withLockedAiReservation(
    reservationId,
    async (row, tx) => {
      if (row.status === "released") {
        throw new Error("The AI billing reservation is unavailable.");
      }
      await tx
        .update(aiCreditReservation)
        .set({
          actualCostMicroCents,
        })
        .where(
          and(
            eq(aiCreditReservation.id, reservationId),
            eq(
              aiCreditReservation.status,
              row.account === null ? "settled" : "reserved"
            ),
            isNull(aiCreditReservation.actualCostMicroCents)
          )
        );
      return row.account !== null;
    }
  );
  if (hasBillingAccount) {
    await reconcileAiCreditReservations({ reservationId });
  }
};

export const releaseAiCreditUsage = async (reservationId: string | null) => {
  if (reservationId === null) {
    return;
  }
  await withLockedAiReservation(reservationId, async (_row, tx) => {
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
