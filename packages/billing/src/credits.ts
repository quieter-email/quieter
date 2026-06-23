import { billingCreditUsageEvent, db, type BillingUsageCategory } from "@quieter/database";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { BillingAccount } from "./entitlements";
import { getPolarApiOrganizationId, ingestPolarEvents } from "./polar";

const BILLING_CREDIT_USAGE_EVENT_NAME = "quieter.credit_usage";
const MICROCENTS_PER_CENT = 1_000_000;

const getBillingCreditUsageWithClient = async (
  client: Pick<typeof db, "select">,
  account: BillingAccount,
) => {
  const [usage] = await client
    .select({
      billableCostMicroCents: sql<number>`coalesce(sum(${billingCreditUsageEvent.billableCostMicroCents}), 0)`,
      costMicroCents: sql<number>`coalesce(sum(${billingCreditUsageEvent.costMicroCents}), 0)`,
    })
    .from(billingCreditUsageEvent)
    .where(
      and(
        eq(billingCreditUsageEvent.organizationId, account.organizationId),
        gte(billingCreditUsageEvent.createdAt, account.currentPeriodStart),
        lt(billingCreditUsageEvent.createdAt, account.currentPeriodEnd),
      ),
    )
    .limit(1);

  return {
    billableCostMicroCents: Number(usage?.billableCostMicroCents ?? 0),
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
