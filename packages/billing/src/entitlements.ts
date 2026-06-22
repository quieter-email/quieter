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
  organizationId: string | null;
  product: BillingProductId;
  scope: "personal" | "team";
  userId: string | null;
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
  organizationId: string | null;
  plan: StoredBillingPlan;
  scope: "personal" | "team";
  status: BillingSubscriptionStatus;
  updatedAt: Date;
  userId: string;
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

const toBillingAccount = (
  row: SubscriptionRow,
  target: { organizationId?: string; userId?: string },
): BillingAccount | null => {
  const parsedProduct = billingProductIdSchema.safeParse(row.plan);
  const product = parsedProduct.success
    ? parsedProduct.data
    : row.plan === "managed"
      ? "team"
      : row.plan === "pro"
        ? target.organizationId
          ? "team_ai"
          : "personal"
        : null;

  if (!product) return null;

  const scope = target.organizationId ? "team" : "personal";

  return {
    creditAmountCents: BILLING_PRODUCTS[product].creditAmountCents,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    externalCustomerId: target.organizationId
      ? `organization:${target.organizationId}`
      : target.userId!,
    organizationId: target.organizationId ?? null,
    product,
    scope,
    userId: target.userId ?? null,
  };
};

const getPersonalSubscription = async (userId: string) => {
  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      organizationId: billingSubscription.organizationId,
      plan: billingSubscription.plan,
      scope: billingSubscription.scope,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
      userId: billingSubscription.userId,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.userId, userId),
        isNull(billingSubscription.organizationId),
        inArray(billingSubscription.plan, ["personal", "pro"]),
      ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const row = rows.find((candidate) => isActiveBillingStatus(candidate.status));

  return row ? toBillingAccount(row, { userId }) : null;
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

  if (assigned?.billingOwnerUserId) return assigned.billingOwnerUserId;

  const [concurrentRecord] = await db
    .select({ billingOwnerUserId: organization.billingOwnerUserId })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);

  return concurrentRecord?.billingOwnerUserId ?? null;
};

const getTeamSubscription = async (organizationId: string) => {
  const rows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      organizationId: billingSubscription.organizationId,
      plan: billingSubscription.plan,
      scope: billingSubscription.scope,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
      userId: billingSubscription.userId,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.organizationId, organizationId),
        eq(billingSubscription.scope, "team"),
        inArray(billingSubscription.plan, ["team", "team_ai"]),
      ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const row = rows.find((candidate) => isActiveBillingStatus(candidate.status));

  if (row) return toBillingAccount(row, { organizationId });

  const legacyBillingOwnerId = await getOrganizationBillingOwnerId(organizationId);
  if (!legacyBillingOwnerId) return null;

  const legacyRows = await db
    .select({
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      organizationId: billingSubscription.organizationId,
      plan: billingSubscription.plan,
      scope: billingSubscription.scope,
      status: billingSubscription.status,
      updatedAt: billingSubscription.updatedAt,
      userId: billingSubscription.userId,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(billingSubscription.userId, legacyBillingOwnerId),
        isNull(billingSubscription.organizationId),
        inArray(billingSubscription.plan, ["managed", "pro"]),
      ),
    )
    .orderBy(desc(billingSubscription.updatedAt));
  const legacyRow = legacyRows.find((candidate) => isActiveBillingStatus(candidate.status));

  return legacyRow ? toBillingAccount(legacyRow, { organizationId }) : null;
};

export const hasUnlimitedBillingAccess = async (userId: string) =>
  !!(await getActiveOverride(userId));

export const getPersonalBillingEntitlement = async (
  userId: string,
): Promise<BillingEntitlement> => {
  if (await getActiveOverride(userId)) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "personal",
    };
  }

  const account = await getPersonalSubscription(userId);

  return {
    account,
    hasAccess: !!account && productHasAi(account.product),
    hasUnlimitedAccess: false,
    product: account?.product ?? null,
  };
};

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
}): Promise<BillingEntitlement> => {
  const account = await getTeamSubscription(input.organizationId);
  const billingOwnerId = await getOrganizationBillingOwnerId(input.organizationId);
  const hasUnlimitedAccess = !!billingOwnerId && !!(await getActiveOverride(billingOwnerId));

  if (hasUnlimitedAccess) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "team_ai",
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
  organizationId?: string;
  userId: string;
}) => {
  if (input.organizationId) {
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
  }

  if (BILLING_FEATURES[input.feature].type === "team") {
    return {
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    } satisfies BillingEntitlement;
  }

  return await getPersonalBillingEntitlement(input.userId);
};

export const assertUserBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId?: string;
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
