import { ORPCError } from "@orpc/server";
import {
  billingSubscription,
  db,
  member,
  user,
  type BillingSubscriptionStatus,
} from "@quieter/database";
import { desc, eq, inArray } from "drizzle-orm";
import {
  BILLING_FEATURES,
  BILLING_PLAN_ORDER,
  hasBillingPlanAccess,
  type BillingFeature,
  type BillingPlan,
  type PaidBillingPlan,
} from "./plans";

const ACTIVE_BILLING_STATUSES = new Set<BillingSubscriptionStatus>([
  "active",
  "past_due",
  "pending",
  "trialing",
]);
const BUILT_IN_UNLIMITED_EMAILS = ["riefel.leander@gmail.com"];

const unlimitedBillingEmails = () =>
  new Set(
    [
      ...BUILT_IN_UNLIMITED_EMAILS,
      ...(process.env.QUIETER_UNLIMITED_BILLING_EMAILS ?? "").split(","),
    ]
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );

export const isActiveBillingStatus = (status: BillingSubscriptionStatus) =>
  ACTIVE_BILLING_STATUSES.has(status);

export const hasUnlimitedBillingAccess = async (userId: string) => {
  const [matchedUser] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);

  return matchedUser ? unlimitedBillingEmails().has(matchedUser.email.toLowerCase()) : false;
};

export const getUserBillingPlan = async (userId: string): Promise<BillingPlan> => {
  const rows = await db
    .select({
      plan: billingSubscription.plan,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.userId, userId))
    .orderBy(desc(billingSubscription.updatedAt));
  const subscription = rows.find((row) => isActiveBillingStatus(row.status)) ?? rows[0] ?? null;

  return subscription && isActiveBillingStatus(subscription.status) ? subscription.plan : "free";
};

export const hasUserBillingFeature = async (input: { feature: BillingFeature; userId: string }) => {
  const [plan, hasUnlimitedAccess] = await Promise.all([
    getUserBillingPlan(input.userId),
    hasUnlimitedBillingAccess(input.userId),
  ]);

  return {
    hasAccess:
      hasUnlimitedAccess ||
      hasBillingPlanAccess(plan, BILLING_FEATURES[input.feature].requiredPlan),
    hasUnlimitedAccess,
    plan,
    requiredPlan: BILLING_FEATURES[input.feature].requiredPlan,
  };
};

export const assertUserBillingFeature = async (input: {
  feature: BillingFeature;
  userId: string;
}) => {
  const result = await hasUserBillingFeature(input);

  if (!result.hasAccess) {
    const requirement = BILLING_FEATURES[input.feature];

    throw new ORPCError("FORBIDDEN", {
      message: `${requirement.description} requires the ${requirement.requiredPlan} plan.`,
    });
  }

  return result;
};

const getOrganizationBillingOwnerIds = async (organizationId: string) => {
  const memberships = await db
    .select({
      role: member.role,
      userId: member.userId,
    })
    .from(member)
    .where(eq(member.organizationId, organizationId));

  return memberships
    .filter((membership) =>
      membership.role
        .split(",")
        .map((part) => part.trim().toLowerCase())
        .some((part) => part === "admin" || part === "owner"),
    )
    .map((membership) => membership.userId);
};

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const requiredPlan = BILLING_FEATURES[input.feature].requiredPlan;
  const billingOwnerIds = await getOrganizationBillingOwnerIds(input.organizationId);

  if (billingOwnerIds.length === 0) {
    return {
      billingUserId: null,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      plan: null,
      requiredPlan,
    };
  }

  const unlimitedAccessChecks = await Promise.all(
    billingOwnerIds.map((userId) => hasUnlimitedBillingAccess(userId)),
  );

  if (unlimitedAccessChecks.some(Boolean)) {
    return {
      billingUserId: billingOwnerIds[unlimitedAccessChecks.findIndex(Boolean)] ?? null,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      plan: null,
      requiredPlan,
    };
  }

  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      plan: billingSubscription.plan,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
      userId: billingSubscription.userId,
    })
    .from(billingSubscription)
    .where(inArray(billingSubscription.userId, billingOwnerIds))
    .orderBy(desc(billingSubscription.updatedAt));
  const activeRows = rows.filter((row) => isActiveBillingStatus(row.status));
  const eligibleRows = activeRows
    .filter((row) => hasBillingPlanAccess(row.plan, requiredPlan))
    .sort((left, right) => {
      const planDelta =
        BILLING_PLAN_ORDER[right.plan as PaidBillingPlan] -
        BILLING_PLAN_ORDER[left.plan as PaidBillingPlan];

      if (planDelta !== 0) return planDelta;

      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });
  const subscription = eligibleRows[0] ?? null;

  return {
    billingUserId: subscription?.userId ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    hasAccess: !!subscription,
    hasUnlimitedAccess: false,
    plan: subscription?.plan ?? null,
    requiredPlan,
  };
};

export const organizationHasBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement(input);

  return entitlement.hasAccess;
};
