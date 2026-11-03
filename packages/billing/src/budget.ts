import type { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  billingAccountSettings,
  billingSubscription,
  organizationMailUsageSettings,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { and, eq, gte, inArray, isNull, lt, ne, sql, sum } from "drizzle-orm";

import type { BillingAccount } from "./entitlements.ts";

export const assertBillingMoney = (...amounts: number[]) => {
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)) {
    throw new RangeError("Billing amounts must be safe nonnegative integers.");
  }
};

export const calculateBillingLiability = (input: {
  costMicroCents: number;
  includedRemainingMicroCents: number;
  overageRemainingMicroCents: number | null;
  authorizedCostMicroCents: number | null;
}) => {
  assertBillingMoney(input.costMicroCents, input.includedRemainingMicroCents);
  if (input.overageRemainingMicroCents !== null) {
    assertBillingMoney(input.overageRemainingMicroCents);
  }
  if (input.authorizedCostMicroCents !== null) {
    assertBillingMoney(input.authorizedCostMicroCents);
  }
  const chargeableCostMicroCents = Math.min(
    input.costMicroCents,
    input.authorizedCostMicroCents ?? Number.MAX_SAFE_INTEGER,
    input.overageRemainingMicroCents === null
      ? Number.MAX_SAFE_INTEGER
      : Math.min(
          Number.MAX_SAFE_INTEGER,
          input.includedRemainingMicroCents + input.overageRemainingMicroCents
        )
  );
  return {
    billableCostMicroCents: Math.max(
      0,
      chargeableCostMicroCents - input.includedRemainingMicroCents
    ),
    chargeableCostMicroCents,
  };
};

export const getBillingLedgerPeriodFilter = (account: BillingAccount) =>
  account.scope === "account" && account.billingOwnerUserId !== undefined
    ? and(
        eq(billingCreditUsageEvent.userId, account.billingOwnerUserId),
        eq(billingCreditUsageEvent.scope, "account"),
        eq(
          billingCreditUsageEvent.billingPeriodStart,
          account.currentPeriodStart
        ),
        account.providerSubscriptionId === undefined
          ? sql`false`
          : eq(
              billingCreditUsageEvent.providerSubscriptionId,
              account.providerSubscriptionId
            )
      )
    : and(
        eq(billingCreditUsageEvent.organizationId, account.organizationId),
        eq(billingCreditUsageEvent.scope, "team"),
        gte(billingCreditUsageEvent.createdAt, account.currentPeriodStart),
        lt(billingCreditUsageEvent.createdAt, account.currentPeriodEnd)
      );

// Admission reserves capacity; settlement consumes only actual usage. Call under
// payer and source team locks to apply account and team caps together.
export const getBillingBudget = async (
  account: BillingAccount,
  client: Pick<typeof db, "select">,
  exclude: { mailSendId?: string; usageDedupeKey?: string } = {}
) => {
  const [totals] = await client
    .select({
      billableCostMicroCents:
        sql`coalesce(${sum(billingCreditUsageEvent.billableCostMicroCents)}, 0)`.mapWith(
          Number
        ),
      chargeableCostMicroCents:
        sql`coalesce(sum(coalesce(${billingCreditUsageEvent.chargeableCostMicroCents}, ${billingCreditUsageEvent.costMicroCents})), 0)`.mapWith(
          Number
        ),
    })
    .from(billingCreditUsageEvent)
    .where(getBillingLedgerPeriodFilter(account));
  const usage = {
    billableCostMicroCents: totals?.billableCostMicroCents ?? 0,
    chargeableCostMicroCents: totals?.chargeableCostMicroCents ?? 0,
    creditAmountMicroCents: account.creditAmountCents * 1_000_000,
  };
  if (
    account.scope === "account" &&
    account.providerSubscriptionId !== undefined
  ) {
    const [period] = await client
      .select({
        creditAmountCents: billingSubscription.periodCreditAmountCents,
      })
      .from(billingSubscription)
      .where(
        and(
          eq(
            billingSubscription.providerSubscriptionId,
            account.providerSubscriptionId
          ),
          eq(billingSubscription.userId, account.billingOwnerUserId ?? ""),
          eq(billingSubscription.scope, "account"),
          eq(billingSubscription.currentPeriodStart, account.currentPeriodStart)
        )
      )
      .limit(1);
    if (
      period?.creditAmountCents !== null &&
      period?.creditAmountCents !== undefined
    ) {
      usage.creditAmountMicroCents = period.creditAmountCents * 1_000_000;
    }
  }
  const [teamSettings] = await client
    .select()
    .from(organizationMailUsageSettings)
    .where(
      eq(organizationMailUsageSettings.organizationId, account.organizationId)
    )
    .limit(1);
  const settings = teamSettings ?? {
    monthlyOverageLimitMicroCents: null,
    overageEnabled: true,
  };
  const [payerSettings] =
    account.scope === "account" && account.billingOwnerUserId !== undefined
      ? await client
          .select()
          .from(billingAccountSettings)
          .where(eq(billingAccountSettings.userId, account.billingOwnerUserId))
          .limit(1)
      : [];
  const accountSettings =
    account.scope === "account"
      ? (payerSettings ?? {
          monthlyOverageLimitMicroCents: null,
          overageEnabled: false,
        })
      : settings;
  const [[ai], [mail], [teamUsage]] = await Promise.all([
    client
      .select({
        cost: sql`coalesce(${sum(aiCreditReservation.reservedCostMicroCents)}, 0)`.mapWith(
          Number
        ),
        teamCost:
          sql`coalesce(sum(case when ${aiCreditReservation.organizationId} = ${account.organizationId} then ${aiCreditReservation.reservedCostMicroCents} else 0 end), 0)`.mapWith(
            Number
          ),
      })
      .from(aiCreditReservation)
      .where(
        and(
          account.scope === "account" &&
            account.billingOwnerUserId !== undefined
            ? and(
                eq(
                  aiCreditReservation.billingUserId,
                  account.billingOwnerUserId
                ),
                sql`${aiCreditReservation.account}->>'scope' = 'account'`
              )
            : and(
                eq(aiCreditReservation.organizationId, account.organizationId),
                sql`coalesce(${aiCreditReservation.account}->>'scope', 'team') = 'team'`
              ),
          eq(aiCreditReservation.status, "reserved"),
          gte(aiCreditReservation.createdAt, account.currentPeriodStart),
          lt(aiCreditReservation.createdAt, account.currentPeriodEnd)
        )
      ),
    client
      .select({
        cost: sql`coalesce(${sum(organizationMailSendIdempotency.estimatedCostMicroCents)}, 0)`.mapWith(
          Number
        ),
        teamCost:
          sql`coalesce(sum(case when ${organizationMailSendIdempotency.organizationId} = ${account.organizationId} then ${organizationMailSendIdempotency.estimatedCostMicroCents} else 0 end), 0)`.mapWith(
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
          account.scope === "account" &&
            account.billingOwnerUserId !== undefined
            ? and(
                eq(
                  organizationMailSendIdempotency.billingUserId,
                  account.billingOwnerUserId
                ),
                sql`${organizationMailSendIdempotency.snapshot}->'billingAccount'->>'scope' = 'account'`
              )
            : and(
                eq(
                  organizationMailSendIdempotency.organizationId,
                  account.organizationId
                ),
                sql`coalesce(${organizationMailSendIdempotency.snapshot}->'billingAccount'->>'scope', 'team') = 'team'`
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
            account.currentPeriodEnd
          ),
          isNull(billingCreditUsageEvent.id),
          exclude.mailSendId === undefined
            ? undefined
            : ne(organizationMailSendIdempotency.id, exclude.mailSendId),
          exclude.usageDedupeKey === undefined
            ? undefined
            : ne(
                sql`'mail:outbound:' || ${organizationMailSendIdempotency.organizationId} || ':' || coalesce(${organizationMailSendIdempotency.response}->>'messageId', '')`,
                exclude.usageDedupeKey
              )
        )
      ),
    client
      .select({
        billable:
          sql`coalesce(${sum(billingCreditUsageEvent.billableCostMicroCents)}, 0)`.mapWith(
            Number
          ),
      })
      .from(billingCreditUsageEvent)
      .where(
        and(
          getBillingLedgerPeriodFilter(account),
          eq(
            billingCreditUsageEvent.sourceOrganizationId,
            account.organizationId
          )
        )
      ),
  ]);
  const pending = (ai?.cost ?? 0) + (mail?.cost ?? 0);
  const teamPending = (ai?.teamCost ?? 0) + (mail?.teamCost ?? 0);
  assertBillingMoney(
    usage.chargeableCostMicroCents,
    usage.billableCostMicroCents,
    usage.creditAmountMicroCents,
    pending,
    teamPending,
    teamUsage?.billable ?? 0
  );
  const includedBeforeHolds = Math.max(
    0,
    usage.creditAmountMicroCents - usage.chargeableCostMicroCents
  );
  const pendingOverage = Math.max(0, pending - includedBeforeHolds);
  const includedRemainingMicroCents = Math.max(
    0,
    includedBeforeHolds - pending
  );
  const limits = [
    {
      settings: accountSettings,
      used: Math.min(
        Number.MAX_SAFE_INTEGER,
        usage.billableCostMicroCents + pendingOverage
      ),
    },
    {
      settings,
      used: Math.min(
        Number.MAX_SAFE_INTEGER,
        (teamUsage?.billable ?? 0) + Math.min(teamPending, pendingOverage)
      ),
    },
  ].map(({ settings: policy, used }) => {
    if (!policy.overageEnabled) {
      return 0;
    }
    if (policy.monthlyOverageLimitMicroCents === null) {
      return null;
    }
    assertBillingMoney(policy.monthlyOverageLimitMicroCents, used);
    return Math.max(0, policy.monthlyOverageLimitMicroCents - used);
  });
  const finiteLimits = limits.filter((limit) => limit !== null);
  const overageRemainingMicroCents =
    finiteLimits.length === 0 ? null : Math.min(...finiteLimits);
  const authorizedCostMicroCents =
    overageRemainingMicroCents === null
      ? null
      : Math.min(
          Number.MAX_SAFE_INTEGER,
          includedRemainingMicroCents + overageRemainingMicroCents
        );
  return {
    authorizedCostMicroCents,
    includedRemainingMicroCents,
    overageRemainingMicroCents,
    pendingAiMicroCents: ai?.cost ?? 0,
    pendingMicroCents: pending,
    settledIncludedRemainingMicroCents: includedBeforeHolds,
  };
};
