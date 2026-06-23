import { ORPCError } from "@orpc/server";
import {
  billingEntitlementOverride,
  billingSubscription,
  db,
  member,
  organization,
  type BillingPlan as StoredBillingPlan,
  type BillingSubscriptionStatus,
} from "@quieter/database";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import {
  BILLING_FEATURES,
  BILLING_PRODUCTS,
  billingProductIdSchema,
  productHasAi,
  productHasManagedMail,
  type BillingFeature,
  type BillingProductId,
} from "./plans";

const ACTIVE_BILLING_STATUSES = new Set<BillingSubscriptionStatus>(["active", "trialing"]);

export const isActiveBillingStatus = (status: BillingSubscriptionStatus) =>
  ACTIVE_BILLING_STATUSES.has(status);

export type BillingAccount = {
  creditAmountCents: number;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  externalCustomerId: string;
  organizationId: string;
  product: BillingProductId;
};

type BillingEntitlement = {
  account: BillingAccount | null;
  hasAccess: boolean;
  hasUnlimitedAccess: boolean;
  product: BillingProductId | null;
};

type SubscriptionRow = {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  metadata: Record<string, string> | null;
  plan: StoredBillingPlan;
  status: BillingSubscriptionStatus;
  updatedAt: Date;
};

export const subscriptionBelongsToOrganization = (
  metadata: Record<string, string> | null,
  organizationId: string,
) => metadata?.quieterOrganizationId === organizationId;

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

const toBillingAccount = (row: SubscriptionRow, organizationId: string): BillingAccount | null => {
  const parsedProduct = billingProductIdSchema.safeParse(row.plan);
  if (!parsedProduct.success) return null;

  return {
    creditAmountCents: BILLING_PRODUCTS[parsedProduct.data].creditAmountCents,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    externalCustomerId: `organization:${organizationId}`,
    organizationId,
    product: parsedProduct.data,
  };
};

const getOrganizationBillingOwnerId = async (organizationId: string) => {
  const [record] = await db
    .select({ billingOwnerUserId: organization.billingOwnerUserId })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  if (record?.billingOwnerUserId) return record.billingOwnerUserId;

  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, "owner")))
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (!owner) return null;

  const [assigned] = await db
    .update(organization)
    .set({ billingOwnerUserId: owner.userId, updatedAt: new Date() })
    .where(and(eq(organization.id, organizationId), isNull(organization.billingOwnerUserId)))
    .returning({ billingOwnerUserId: organization.billingOwnerUserId });

  return assigned?.billingOwnerUserId ?? owner.userId;
};

const getOrganizationSubscription = async (organizationId: string) => {
  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      metadata: billingSubscription.metadata,
      plan: billingSubscription.plan,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.organizationId, organizationId),
        inArray(billingSubscription.plan, ["managed", "pro"]),
      ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const row = rows.find(
    (candidate) =>
      isActiveBillingStatus(candidate.status) &&
      subscriptionBelongsToOrganization(candidate.metadata, organizationId),
  );

  return row ? toBillingAccount(row, organizationId) : null;
};

export const hasUnlimitedBillingAccess = async (userId: string) =>
  !!(await getActiveOverride(userId));

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
}): Promise<BillingEntitlement> => {
  const account = await getOrganizationSubscription(input.organizationId);
  const billingOwnerId = await getOrganizationBillingOwnerId(input.organizationId);
  const hasUnlimitedAccess = !!billingOwnerId && !!(await getActiveOverride(billingOwnerId));

  if (hasUnlimitedAccess) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "pro",
    };
  }

  const hasAccess =
    !!account &&
    (BILLING_FEATURES[input.feature].type === "team"
      ? productHasManagedMail(account.product)
      : productHasAi(account.product));

  return {
    account,
    hasAccess,
    hasUnlimitedAccess: false,
    product: account?.product ?? null,
  };
};

export const hasUserBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
  userId: string;
}) => {
  const [membership] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, input.userId), eq(member.organizationId, input.organizationId)))
    .limit(1);

  if (!membership) {
    return {
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    } satisfies BillingEntitlement;
  }

  return await getOrganizationBillingEntitlement({
    feature: input.feature,
    organizationId: input.organizationId,
  });
};

export const assertUserBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
  userId: string;
}) => {
  const result = await hasUserBillingFeature(input);

  if (!result.hasAccess) {
    const requirement = BILLING_FEATURES[input.feature];

    throw new ORPCError("FORBIDDEN", {
      message: `${requirement.description} requires ${requirement.requirementLabel}.`,
    });
  }

  return result;
};

export const organizationHasBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => (await getOrganizationBillingEntitlement(input)).hasAccess;
