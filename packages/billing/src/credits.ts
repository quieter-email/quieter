import { billingCreditUsageEvent, db, type BillingUsageCategory } from "@quieter/database";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { BillingAccount } from "./entitlements";
import { getPolarApiOrganizationId, ingestPolarEvents } from "./polar";

const BILLING_CREDIT_USAGE_EVENT_NAME = "credit-usage";
const MICROCENTS_PER_CENT = 1_000_000;

export const BILLING_USAGE_KINDS = [
  "aiChat",
  "autoLabel",
  "usefulDetails",
  "inboundMail",
  "outboundMail",
  "other",
] as const;

export type BillingUsageKind = (typeof BILLING_USAGE_KINDS)[number];

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
        id: billingCreditUsageEvent.id,
        polarEventReportedAt: billingCreditUsageEvent.polarEventReportedAt,
      })
      .from(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.dedupeKey, input.dedupeKey))
      .limit(1);

    if (existingEvent) {
      return {
        billableCostMicroCents: existingEvent.billableCostMicroCents,
        eventId: existingEvent.id,
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
      billableCostMicroCents: event ? billableCostMicroCents : 0,
      eventId: event?.id ?? null,
      polarEventReportedAt: null,
    };
  });

  if (result.eventId && result.billableCostMicroCents > 0 && !result.polarEventReportedAt) {
    await ingestPolarEvents([
      {
        externalCustomerId: input.account.externalCustomerId,
        externalId: `credit-usage:${result.eventId}`,
        metadata: {
          billableCostCents: result.billableCostMicroCents / MICROCENTS_PER_CENT,
          category: input.category,
          credits: result.billableCostMicroCents / MICROCENTS_PER_CENT,
          creditUsageEventId: result.eventId,
          ...input.metadata,
        },
        name: BILLING_CREDIT_USAGE_EVENT_NAME,
        organizationId: getPolarApiOrganizationId(),
      },
    ]);

    await db
      .update(billingCreditUsageEvent)
      .set({ polarEventReportedAt: new Date() })
      .where(eq(billingCreditUsageEvent.id, result.eventId));
  }

  return result;
};
