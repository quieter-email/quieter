import { ORPCError } from "@orpc/server";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";

export const assertAiChatCredits = async (input: {
  organizationId: string;
  userId: string;
}) => {
  const entitlement = await hasUserBillingFeature({
    feature: "aiChat",
    organizationId: input.organizationId,
    userId: input.userId,
  });
  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: `AI chat requires ${BILLING_FEATURES.aiChat.requirementLabel}.`,
    });
  }
  if (entitlement.hasUnlimitedAccess || !entitlement.account) {
    return;
  }
  const usage = await getBillingCreditUsage(entitlement.account);
  if (usage.costMicroCents >= usage.creditAmountMicroCents) {
    throw new ORPCError("FORBIDDEN", {
      message: "AI chat requires available usage balance.",
    });
  }
};
