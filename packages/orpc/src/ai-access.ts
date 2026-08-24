import { ORPCError } from "@orpc/server";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";

export const assertCanUseAi = async ({
  organizationId,
  userId,
}: {
  organizationId: string;
  userId: string;
}) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId,
    userId,
  });

  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: `AI features require ${BILLING_FEATURES.aiChat.requirementLabel}.`,
    });
  }

  if (entitlement.hasUnlimitedAccess || !entitlement.account) {
    return;
  }

  const usage = await getBillingCreditUsage(entitlement.account);
  if (usage.costMicroCents >= usage.creditAmountMicroCents) {
    throw new ORPCError("FORBIDDEN", {
      message: "AI features require available usage balance.",
    });
  }
};
