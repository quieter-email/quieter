import {
  billingCreditUsageEvent,
  db,
  type BillingScope,
  type BillingUsageCategory,
} from "@quieter/database";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import type { BillingAccount } from "./entitlements";
import { BILLING_PRICE_CURRENCIES, type BillingPriceCurrency } from "./plans";
import { getPolarApiOrganizationId, getPolarClient, ingestPolarEvents } from "./polar";

const BILLING_CREDIT_USAGE_EVENT_NAME = "quieter.credit_usage";
const BILLING_CREDIT_USAGE_METER_KEY = "quieter_credit_usage";
const MICROCENTS_PER_CENT = 1_000_000;

const creditUsageMeterIds = new Map<BillingPriceCurrency, string>();

const getCreditUsageMeterId = async (currency: BillingPriceCurrency) => {
  const cachedMeterId = creditUsageMeterIds.get(currency);
  if (cachedMeterId) return cachedMeterId;

  const polar = await getPolarClient();
  const organizationId = getPolarApiOrganizationId();
  const metadataKey = `${BILLING_CREDIT_USAGE_METER_KEY}:${currency}`;
  const meters = await polar.meters.list({
    limit: 100,
    metadata: {
      quieterMeter: metadataKey,
    },
    organizationId,
  });
  const existingMeter = meters.result.items.find(
    (meter) => meter.metadata.quieterMeter === metadataKey,
  );

  if (existingMeter) {
    creditUsageMeterIds.set(currency, existingMeter.id);
    return existingMeter.id;
  }

  const createdMeter = await polar.meters.create({
    aggregation: {
      func: "sum",
      property: "billableCostCents",
    },
    filter: {
      clauses: [
        {
          operator: "eq",
          property: "name",
          value: BILLING_CREDIT_USAGE_EVENT_NAME,
        },
      ],
      conjunction: "and",
    },
    metadata: {
      quieterMeter: metadataKey,
    },
    name: `Quieter credit overage (${currency.toUpperCase()})`,
    organizationId,
  });

  creditUsageMeterIds.set(currency, createdMeter.id);
  return createdMeter.id;
};

export const getCreditUsageMeteredPrices = async () =>
  await Promise.all(
    BILLING_PRICE_CURRENCIES.map(async (priceCurrency) => ({
      amountType: "metered_unit" as const,
      meterId: await getCreditUsageMeterId(priceCurrency),
      priceCurrency,
      unitAmount: "1",
    })),
  );

const getTargetCondition = (input: {
  organizationId: string | null;
  scope: BillingScope;
  userId: string | null;
}) =>
  input.scope === "personal"
    ? and(
        eq(billingCreditUsageEvent.scope, "personal"),
        eq(billingCreditUsageEvent.userId, input.userId!),
      )
    : and(
        eq(billingCreditUsageEvent.scope, "team"),
        eq(billingCreditUsageEvent.organizationId, input.organizationId!),
      );

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
        getTargetCondition(account),
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
  const lockKey = `${input.account.scope}:${input.account.organizationId ?? input.account.userId}`;
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
        scope: input.account.scope,
        userId: input.account.userId,
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
    await Promise.all(BILLING_PRICE_CURRENCIES.map(getCreditUsageMeterId));
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
