import { db } from "@quieter/database/client";
import {
  billingCreditUsageEvent,
  billingSubscription,
  type BillingUsageCategory,
} from "@quieter/database/schema";
import { and, asc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import type { BillingAccount } from "./entitlements";
import { getPolarApiOrganizationId, ingestPolarEvents } from "./polar";

const BILLING_CREDIT_USAGE_EVENT_NAME = "credit-usage";
const MICROCENTS_PER_CENT = 1_000_000;

export const BILLING_USAGE_KINDS = [
  "aiChat",
  "aiMemory",
  "autoLabel",
  "usefulDetails",
  "inboundMail",
  "outboundMail",
  "other",
] as const;

export type BillingUsageKind = (typeof BILLING_USAGE_KINDS)[number];

const sanitizePolarEventMetadata = (metadata: Record<string, string | number | boolean>) =>
  Object.fromEntries(Object.entries(metadata).filter(([, value]) => value !== ""));

export const createPolarCreditUsageEvent = (input: {
  account: Pick<BillingAccount, "externalCustomerId">;
  billableCostMicroCents: number;
  category: BillingUsageCategory;
  costMicroCents: number;
  eventId: string;
  metadata: Record<string, string | number | boolean>;
}) => ({
  externalCustomerId: input.account.externalCustomerId,
  externalId: `credit-usage:${input.eventId}`,
  metadata: {
    billableCostCents: input.billableCostMicroCents / MICROCENTS_PER_CENT,
    category: input.category,
    credits: input.costMicroCents / MICROCENTS_PER_CENT,
    creditUsageEventId: input.eventId,
    totalCostCents: input.costMicroCents / MICROCENTS_PER_CENT,
    ...sanitizePolarEventMetadata(input.metadata),
  },
  name: BILLING_CREDIT_USAGE_EVENT_NAME,
  organizationId: getPolarApiOrganizationId(),
});

const getBillingCreditUsageWithClient = async (
  client: Pick<typeof db, "select">,
  account: BillingAccount,
) => {
  const periodFilter = and(
    eq(billingCreditUsageEvent.organizationId, account.organizationId),
    gte(billingCreditUsageEvent.createdAt, account.currentPeriodStart),
    lt(billingCreditUsageEvent.createdAt, account.currentPeriodEnd),
  );
  const usageKind = sql<BillingUsageKind>`case
    when ${billingCreditUsageEvent.category} = 'mail'
      and ${billingCreditUsageEvent.metadata}->>'direction' = 'inbound' then 'inboundMail'
    when ${billingCreditUsageEvent.category} = 'mail'
      and ${billingCreditUsageEvent.metadata}->>'direction' = 'outbound' then 'outboundMail'
    when ${billingCreditUsageEvent.category} = 'ai'
      and ${billingCreditUsageEvent.metadata}->>'usageKind' = 'autoLabel' then 'autoLabel'
    when ${billingCreditUsageEvent.category} = 'ai'
      and ${billingCreditUsageEvent.metadata}->>'usageKind' = 'aiMemory' then 'aiMemory'
    when ${billingCreditUsageEvent.category} = 'ai'
      and ${billingCreditUsageEvent.metadata}->>'usageKind' = 'usefulDetails' then 'usefulDetails'
    when ${billingCreditUsageEvent.category} = 'ai' then 'aiChat'
    else 'other'
  end`;
  const [[usage], breakdown] = await Promise.all([
    client
      .select({
        billableCostMicroCents: sql<number>`coalesce(sum(${billingCreditUsageEvent.billableCostMicroCents}), 0)`,
        costMicroCents: sql<number>`coalesce(sum(${billingCreditUsageEvent.costMicroCents}), 0)`,
      })
      .from(billingCreditUsageEvent)
      .where(periodFilter)
      .limit(1),
    client
      .select({
        costMicroCents: sql<number>`coalesce(sum(${billingCreditUsageEvent.costMicroCents}), 0)`,
        kind: usageKind,
      })
      .from(billingCreditUsageEvent)
      .where(periodFilter)
      .groupBy(usageKind),
  ]);

  return {
    billableCostMicroCents: Number(usage?.billableCostMicroCents ?? 0),
    breakdown: breakdown.map((item) => ({
      costMicroCents: Number(item.costMicroCents),
      kind: item.kind,
    })),
    costMicroCents: Number(usage?.costMicroCents ?? 0),
    creditAmountMicroCents: account.creditAmountCents * MICROCENTS_PER_CENT,
  };
};

export const getBillingCreditUsage = async (account: BillingAccount) =>
  await getBillingCreditUsageWithClient(db, account);

export const recordBillingCreditUsage = async (input: {
  account: BillingAccount;
  category: BillingUsageCategory;
  costMicroCents: number;
  dedupeKey: string;
  metadata?: Record<string, string | number | boolean>;
}) => {
  const lockKey = `organization:${input.account.organizationId}`;
  const result = await db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
    const [existingEvent] = await transaction
      .select({
        billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents,
        category: billingCreditUsageEvent.category,
        costMicroCents: billingCreditUsageEvent.costMicroCents,
        id: billingCreditUsageEvent.id,
        metadata: billingCreditUsageEvent.metadata,
        polarEventReportedAt: billingCreditUsageEvent.polarEventReportedAt,
      })
      .from(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.dedupeKey, input.dedupeKey))
      .limit(1);

    if (existingEvent) {
      return {
        billableCostMicroCents: existingEvent.billableCostMicroCents,
        category: existingEvent.category,
        costMicroCents: existingEvent.costMicroCents,
        eventId: existingEvent.id,
        metadata: existingEvent.metadata ?? {},
        polarEventReportedAt: existingEvent.polarEventReportedAt,
      };
    }

    const usage = await getBillingCreditUsageWithClient(transaction, input.account);
    const billableBefore = Math.max(0, usage.costMicroCents - usage.creditAmountMicroCents);
    const billableAfter = Math.max(
      0,
      usage.costMicroCents + input.costMicroCents - usage.creditAmountMicroCents,
    );
    const billableCostMicroCents = billableAfter - billableBefore;
    const [event] = await transaction
      .insert(billingCreditUsageEvent)
      .values({
        billableCostMicroCents,
        category: input.category,
        costMicroCents: input.costMicroCents,
        createdAt: new Date(),
        dedupeKey: input.dedupeKey,
        id: crypto.randomUUID(),
        metadata: input.metadata ?? {},
        organizationId: input.account.organizationId,
        scope: "team",
      })
      .onConflictDoNothing({ target: billingCreditUsageEvent.dedupeKey })
      .returning({
        id: billingCreditUsageEvent.id,
      });

    return {
      category: input.category,
      billableCostMicroCents: event ? billableCostMicroCents : 0,
      costMicroCents: input.costMicroCents,
      eventId: event?.id ?? null,
      metadata: input.metadata ?? {},
      polarEventReportedAt: null,
    };
  });

  if (result.eventId && result.costMicroCents > 0 && !result.polarEventReportedAt) {
    const polarEventReportedAt = new Date();

    try {
      await ingestPolarEvents([
        createPolarCreditUsageEvent({
          account: input.account,
          billableCostMicroCents: result.billableCostMicroCents,
          category: result.category,
          costMicroCents: result.costMicroCents,
          eventId: result.eventId,
          metadata: result.metadata,
        }),
      ]);
    } catch (error) {
      console.error("Polar usage sync failed; the event remains queued for retry.", error);
      return result;
    }

    await db
      .update(billingCreditUsageEvent)
      .set({ polarEventReportedAt })
      .where(eq(billingCreditUsageEvent.id, result.eventId));

    return {
      ...result,
      polarEventReportedAt,
    };
  }

  return result;
};

const currentActiveSubscriptionUnreportedUsageFilter = and(
  eq(billingSubscription.organizationId, billingCreditUsageEvent.organizationId),
  inArray(billingSubscription.plan, ["managed", "pro"]),
  inArray(billingSubscription.status, ["active", "trialing"]),
  gte(billingCreditUsageEvent.createdAt, billingSubscription.currentPeriodStart),
  lt(billingCreditUsageEvent.createdAt, billingSubscription.currentPeriodEnd),
);

const unreportedPositiveCreditUsageFilter = and(
  isNull(billingCreditUsageEvent.polarEventReportedAt),
  gt(billingCreditUsageEvent.costMicroCents, 0),
);

export const syncUnreportedBillingCreditUsage = async (input: { limit?: number } = {}) => {
  const limit = input.limit ?? 100;
  const rows = await db
    .select({
      billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents,
      category: billingCreditUsageEvent.category,
      costMicroCents: billingCreditUsageEvent.costMicroCents,
      eventId: billingCreditUsageEvent.id,
      metadata: billingCreditUsageEvent.metadata,
      organizationId: billingCreditUsageEvent.organizationId,
    })
    .from(billingCreditUsageEvent)
    .innerJoin(billingSubscription, currentActiveSubscriptionUnreportedUsageFilter)
    .where(unreportedPositiveCreditUsageFilter)
    .orderBy(asc(billingCreditUsageEvent.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    return {
      remaining: false,
      synced: 0,
    };
  }

  const polarEventReportedAt = new Date();

  await ingestPolarEvents(
    rows.map((row) =>
      createPolarCreditUsageEvent({
        account: {
          externalCustomerId: `organization:${row.organizationId}`,
        },
        billableCostMicroCents: row.billableCostMicroCents,
        category: row.category,
        costMicroCents: row.costMicroCents,
        eventId: row.eventId,
        metadata: row.metadata ?? {},
      }),
    ),
  );

  await db
    .update(billingCreditUsageEvent)
    .set({ polarEventReportedAt })
    .where(
      and(
        inArray(
          billingCreditUsageEvent.id,
          rows.map((row) => row.eventId),
        ),
        isNull(billingCreditUsageEvent.polarEventReportedAt),
      ),
    );

  return {
    remaining: rows.length === limit,
    synced: rows.length,
  };
};
