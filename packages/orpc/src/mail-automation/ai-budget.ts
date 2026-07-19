import { ORPCError } from "@orpc/server";
import { getBillingCreditUsage } from "@quieter/billing/credits";
import { hasUserBillingFeature } from "@quieter/billing/entitlements";
import { BILLING_FEATURES } from "@quieter/billing/plans";
import { serverEnv } from "@quieter/env/server";

export const MAIL_AUTOMATION_AI_PAUSED_MESSAGE =
  "AI automation is paused until usage balance is available.";

const mailAutomationAiRuntimeEnabled = () =>
  serverEnv.QUIETER_GMAIL_AI_AUTOMATION_ENABLED ??
  serverEnv.QUIETER_DEPLOYMENT_ENV === "production";

export const resolveMailAutomationAiBudgetStatus = (input: {
  hasAccess: boolean;
  hasAccount: boolean;
  hasUnlimitedAccess: boolean;
  missingOrganization?: boolean;
  runtimeEnabled: boolean;
  usage?: { costMicroCents: number; creditAmountMicroCents: number };
}) => {
  if (!input.runtimeEnabled) {
    return {
      allowed: false,
      message: "AI automation is disabled in this environment.",
      reason: "environment_disabled",
    } as const;
  }

  if (input.missingOrganization) {
    return {
      allowed: false,
      message: "AI automation requires a mailbox assigned to a team.",
      reason: "missing_organization",
    } as const;
  }

  if (!input.hasAccess) {
    return {
      allowed: false,
      message: `Gmail automation requires ${BILLING_FEATURES.gmailAutomation.requirementLabel}.`,
      reason: "plan_ineligible",
    } as const;
  }

  if (input.hasUnlimitedAccess) {
    return { allowed: true, reason: "allowed" } as const;
  }

  if (!input.hasAccount || !input.usage) {
    return {
      allowed: false,
      message: "AI automation is unavailable until team billing usage is available.",
      reason: "billing_usage_unavailable",
    } as const;
  }

  if (input.usage.costMicroCents >= input.usage.creditAmountMicroCents) {
    return {
      allowed: false,
      message: MAIL_AUTOMATION_AI_PAUSED_MESSAGE,
      reason: "credits_exhausted",
    } as const;
  }

  return { allowed: true, reason: "allowed" } as const;
};

export const getMailAutomationAiBudgetStatus = async (input: {
  organizationId: string | null | undefined;
  userId: string;
}) => {
  const runtimeEnabled = mailAutomationAiRuntimeEnabled();
  if (!runtimeEnabled) {
    return resolveMailAutomationAiBudgetStatus({
      hasAccess: false,
      hasAccount: false,
      hasUnlimitedAccess: false,
      runtimeEnabled,
    });
  }
  if (!input.organizationId) {
    return resolveMailAutomationAiBudgetStatus({
      hasAccess: false,
      hasAccount: false,
      hasUnlimitedAccess: false,
      missingOrganization: true,
      runtimeEnabled,
    });
  }

  const entitlement = await hasUserBillingFeature({
    feature: "gmailAutomation",
    organizationId: input.organizationId,
    userId: input.userId,
  });

  return resolveMailAutomationAiBudgetStatus({
    hasAccess: entitlement.hasAccess,
    hasAccount: !!entitlement.account,
    hasUnlimitedAccess: entitlement.hasUnlimitedAccess,
    runtimeEnabled,
    usage: entitlement.account ? await getBillingCreditUsage(entitlement.account) : undefined,
  });
};

export const assertMailAutomationAiBudget = async (input: {
  organizationId: string | null | undefined;
  userId: string;
}) => {
  const status = await getMailAutomationAiBudgetStatus(input);

  if (!status.allowed) {
    throw new ORPCError("FORBIDDEN", { message: status.message });
  }
};
