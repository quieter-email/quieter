import { ORPCError } from "@orpc/server";
import {
  billingEntitlementOverride,
  billingSubscription,
  db,
  member,
  organization,
  type BillingSubscriptionStatus,
} from "@quieter/database";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import {
  BILLING_FEATURES,
  hasBillingPlanAccess,
  type BillingFeature,
  type BillingPlan,
  type PaidBillingPlan,
} from "./plans";

const ACTIVE_BILLING_STATUSES = new Set<BillingSubscriptionStatus>(["active", "trialing"]);

export const isActiveBillingStatus = (status: BillingSubscriptionStatus) =>
  ACTIVE_BILLING_STATUSES.has(status);

type OrganizationBillingOwnerRepository = {
  assignBillingOwnerId: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<string | null>;
  getBillingOwnerId: (organizationId: string) => Promise<string | null>;
  getFirstOwnerId: (organizationId: string) => Promise<string | null>;
};

type OrganizationSubscription = {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  plan: PaidBillingPlan;
  status: BillingSubscriptionStatus;
  updatedAt: Date;
};

export const resolveOrganizationBillingOwnerId = async (
  organizationId: string,
  repository: OrganizationBillingOwnerRepository,
) => {
  const currentBillingOwnerId = await repository.getBillingOwnerId(organizationId);
  if (currentBillingOwnerId) return currentBillingOwnerId;

  const firstOwnerId = await repository.getFirstOwnerId(organizationId);
  if (!firstOwnerId) return null;

  const assignedBillingOwnerId = await repository.assignBillingOwnerId({
    organizationId,
    userId: firstOwnerId,
  });
  if (assignedBillingOwnerId) return assignedBillingOwnerId;

  return await repository.getBillingOwnerId(organizationId);
};

export const resolveOrganizationBillingEntitlement = (input: {
  billingOwnerId: string;
  overridePlan: PaidBillingPlan | null;
  requiredPlan: PaidBillingPlan;
  subscriptions: OrganizationSubscription[];
}) => {
  if (input.overridePlan) {
    return {
      billingUserId: input.billingOwnerId,
      currentPeriodEnd: null,
      currentPeriodStart: null,
      hasAccess: hasBillingPlanAccess(input.overridePlan, input.requiredPlan),
      hasUnlimitedAccess: true,
      plan: input.overridePlan,
      requiredPlan: input.requiredPlan,
    };
  }

  const subscription =
    input.subscriptions.find(
      (row) =>
        isActiveBillingStatus(row.status) && hasBillingPlanAccess(row.plan, input.requiredPlan),
    ) ?? null;

  return {
    billingUserId: subscription ? input.billingOwnerId : null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    hasAccess: !!subscription,
    hasUnlimitedAccess: false,
    plan: subscription?.plan ?? null,
    requiredPlan: input.requiredPlan,
  };
};

const getActiveOverride = async (userId: string) => {
  const [override] = await db
    .select({ plan: billingEntitlementOverride.plan })
    .from(billingEntitlementOverride)
    .where(
      and(
        eq(billingEntitlementOverride.userId, userId),
        isNull(billingEntitlementOverride.revokedAt),
        or(
          isNull(billingEntitlementOverride.expiresAt),
          gt(billingEntitlementOverride.expiresAt, new Date()),
        ),
      ),
    )
    .orderBy(desc(billingEntitlementOverride.updatedAt))
    .limit(1);

  return override ?? null;
};

export const hasUnlimitedBillingAccess = async (userId: string) =>
  !!(await getActiveOverride(userId));

export const getUserBillingPlan = async (userId: string): Promise<BillingPlan> => {
  const override = await getActiveOverride(userId);
  if (override) return override.plan;

  const rows = await db
    .select({
      plan: billingSubscription.plan,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.userId, userId))
    .orderBy(desc(billingSubscription.updatedAt));
  const subscription = rows.find((row) => isActiveBillingStatus(row.status)) ?? null;

  return subscription?.plan ?? "free";
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

const getOrganizationBillingOwnerId = async (organizationId: string) => {
  return await resolveOrganizationBillingOwnerId(organizationId, {
    assignBillingOwnerId: async (input) => {
      const [assigned] = await db
        .update(organization)
        .set({ billingOwnerUserId: input.userId, updatedAt: new Date() })
        .where(
          and(eq(organization.id, input.organizationId), isNull(organization.billingOwnerUserId)),
        )
        .returning({ billingOwnerUserId: organization.billingOwnerUserId });

      return assigned?.billingOwnerUserId ?? null;
    },
    getBillingOwnerId: async (id) => {
      const [record] = await db
        .select({ billingOwnerUserId: organization.billingOwnerUserId })
        .from(organization)
        .where(eq(organization.id, id))
        .limit(1);

      return record?.billingOwnerUserId ?? null;
    },
    getFirstOwnerId: async (id) => {
      const [owner] = await db
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, id), eq(member.role, "owner")))
        .orderBy(member.createdAt)
        .limit(1);

      return owner?.userId ?? null;
    },
  });
};

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const requiredPlan = BILLING_FEATURES[input.feature].requiredPlan;
  const billingOwnerId = await getOrganizationBillingOwnerId(input.organizationId);

  if (!billingOwnerId) {
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

  const override = await getActiveOverride(billingOwnerId);
  if (override) {
    return resolveOrganizationBillingEntitlement({
      billingOwnerId,
      overridePlan: override.plan,
      requiredPlan,
      subscriptions: [],
    });
  }

  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      plan: billingSubscription.plan,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.userId, billingOwnerId))
    .orderBy(desc(billingSubscription.updatedAt));

  return resolveOrganizationBillingEntitlement({
    billingOwnerId,
    overridePlan: null,
    requiredPlan,
    subscriptions: rows,
  });
};

export const organizationHasBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement(input);

  return entitlement.hasAccess;
};
