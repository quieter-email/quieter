import { ORPCError } from "@orpc/server";
import type { DatabaseClient } from "@quieter/database/client";
import type { MailAcceptanceBudget } from "@quieter/database/mail-acceptance";
import { mailUsageReservation } from "@quieter/database/schema";
import { and, eq, sql } from "drizzle-orm";

import { getBillingCreditUsage } from "./credits.ts";
import { getOrganizationBillingEntitlement } from "./entitlements.ts";
import { getOrganizationMailUsageSettings } from "./organization-mail-usage.ts";
import { applyManagedUsageMarkup } from "./ses-pricing.ts";

export const reserveMailSubmissionUsage = async (
  transaction: Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0],
  input: { organizationId: string; sesCostMicroCents: number }
): Promise<MailAcceptanceBudget> => {
  if (
    !Number.isSafeInteger(input.sesCostMicroCents) ||
    input.sesCostMicroCents < 0
  ) {
    throw new Error("Invalid mail usage estimate.");
  }
  await transaction.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`organization:${input.organizationId}`}, 0))`
  );
  const entitlement = await getOrganizationBillingEntitlement({
    database: transaction,
    feature: "organizationMail",
    organizationId: input.organizationId,
  });
  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Team mail requires Managed billing.",
    });
  }
  if (entitlement.hasUnlimitedAccess) {
    const now = new Date();
    return {
      billableCostMicroCents: 0,
      creditAmountMicroCents: 0,
      includedCostMicroCents: 0,
      periodEnd: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
      ),
      periodStart: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
      ),
      sesCostMicroCents: input.sesCostMicroCents,
    };
  }
  const { account } = entitlement;
  if (account === null) {
    throw new Error("Mail access has no billing account.");
  }
  const usage = await getBillingCreditUsage(account, transaction);
  const settings = await getOrganizationMailUsageSettings(
    input.organizationId,
    transaction
  );
  const [pending] = await transaction
    .select({
      cost: sql`coalesce(sum(${mailUsageReservation.billableCostMicroCents} + ${mailUsageReservation.includedCostMicroCents}), 0)`.mapWith(
        Number
      ),
    })
    .from(mailUsageReservation)
    .where(
      and(
        eq(mailUsageReservation.organizationId, input.organizationId),
        eq(mailUsageReservation.status, "reserved"),
        eq(mailUsageReservation.periodStart, account.currentPeriodStart),
        eq(mailUsageReservation.periodEnd, account.currentPeriodEnd)
      )
    );
  const cost = applyManagedUsageMarkup({
    sesCostUsdMicroCents: input.sesCostMicroCents,
  });
  const used = usage.costMicroCents + (pending?.cost ?? 0);
  if (
    ![cost, used, used + cost, usage.creditAmountMicroCents].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  ) {
    throw new Error("Mail budget exceeds the safe accounting range.");
  }
  const projectedOverage = Math.max(
    0,
    used + cost - usage.creditAmountMicroCents
  );
  if (
    (projectedOverage > 0 && !settings.overageEnabled) ||
    (settings.monthlyOverageLimitMicroCents !== null &&
      projectedOverage > settings.monthlyOverageLimitMicroCents)
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "This team's usage limit has been reached for the billing period.",
    });
  }
  const billable =
    projectedOverage - Math.max(0, used - usage.creditAmountMicroCents);
  return {
    billableCostMicroCents: billable,
    creditAmountMicroCents: usage.creditAmountMicroCents,
    includedCostMicroCents: cost - billable,
    periodEnd: account.currentPeriodEnd,
    periodStart: account.currentPeriodStart,
    sesCostMicroCents: input.sesCostMicroCents,
  };
};
