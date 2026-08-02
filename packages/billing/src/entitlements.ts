import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  billingEntitlementOverride,
  billingSubscription,
  member,
  organization,
  type BillingPlan as StoredBillingPlan,
  type BillingSubscriptionStatus,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
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

type BillingRuntimeEnvironment = Pick<
  typeof serverEnv,
  "BETTER_AUTH_URL" | "NODE_ENV" | "QUIETER_DEPLOYMENT_ENV" | "QUIETER_LOCAL_BILLING_BYPASS"
>;

const isLoopbackUrl = (value: string | undefined) => {
  if (!value) return false;
  const hostname = new URL(value).hostname.replace(/^\[(.*)\]$/, "$1");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
};

export const isLocalDevelopmentBillingEntitlementEnabled = (
  env: BillingRuntimeEnvironment = serverEnv,
) =>
  env.NODE_ENV !== "test" &&
  (env.NODE_ENV === "development" || isLoopbackUrl(env.BETTER_AUTH_URL)) &&
  env.QUIETER_DEPLOYMENT_ENV === "local" &&
  env.QUIETER_LOCAL_BILLING_BYPASS === true;

const localDevelopmentBillingEntitlement = (): BillingEntitlement => ({
  account: null,
  hasAccess: true,
  hasUnlimitedAccess: true,
  product: "pro",
});

type SubscriptionRow = {
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  lastReconciliationFailureAt: Date | null;
  metadata: Record<string, string> | null;
  plan: StoredBillingPlan;
  provider: "polar";
  providerSubscriptionId: string;
  status: BillingSubscriptionStatus;
  updatedAt: Date;
};

const BILLING_RECONCILIATION_INTERVAL_MS = 5 * 60 * 1000;
const BILLING_RECONCILIATION_TIMEOUT_MS = 5_000;

export const shouldReconcileExpiredBillingSubscription = (
  row: Pick<SubscriptionRow, "currentPeriodEnd" | "lastReconciliationFailureAt" | "updatedAt">,
  now = new Date(),
) => {
  const lastAttemptAt = row.lastReconciliationFailureAt ?? row.updatedAt;

  return (
    row.currentPeriodEnd <= now &&
    now.getTime() - lastAttemptAt.getTime() >= BILLING_RECONCILIATION_INTERVAL_MS
  );
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

const recordReconciliationFailure = async ({
  organizationId,
  providerSubscriptionId,
}: {
  organizationId: string;
  providerSubscriptionId: string;
}) => {
  try {
    await db
      .update(billingSubscription)
      .set({ lastReconciliationFailureAt: new Date() })
      .where(
        and(
          eq(billingSubscription.organizationId, organizationId),
          eq(billingSubscription.provider, "polar"),
          eq(billingSubscription.providerSubscriptionId, providerSubscriptionId),
        ),
      );
  } catch (error) {
    console.error("Failed to record a billing reconciliation failure.", {
      error,
      organizationId,
      providerSubscriptionId,
    });
  }
};

export const getOrganizationSubscription = async (organizationId: string) => {
  const loadRows = () =>
    db
      .select({
        currentPeriodEnd: billingSubscription.currentPeriodEnd,
        currentPeriodStart: billingSubscription.currentPeriodStart,
        lastReconciliationFailureAt: billingSubscription.lastReconciliationFailureAt,
        metadata: billingSubscription.metadata,
        plan: billingSubscription.plan,
        provider: billingSubscription.provider,
        providerSubscriptionId: billingSubscription.providerSubscriptionId,
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

  const findActiveRow = (rows: Awaited<ReturnType<typeof loadRows>>) =>
    rows.find(
      (candidate) =>
        isActiveBillingStatus(candidate.status) &&
        subscriptionBelongsToOrganization(candidate.metadata, organizationId),
    );

  let row = findActiveRow(await loadRows());
  if (!row) return null;

  if (row.provider === "polar" && shouldReconcileExpiredBillingSubscription(row)) {
    const providerSubscriptionId = row.providerSubscriptionId;
    try {
      const [{ getPolarClient }, { syncBillingSubscription }] = await Promise.all([
        import("./polar"),
        import("./subscription-sync"),
      ]);
      const subscription = await getPolarClient().subscriptions.get(
        { id: providerSubscriptionId },
        { signal: AbortSignal.timeout(BILLING_RECONCILIATION_TIMEOUT_MS) },
      );
      const syncResult = await syncBillingSubscription(subscription, { force: true });
      if (!syncResult.synced) {
        await recordReconciliationFailure({ organizationId, providerSubscriptionId });
        return null;
      }
      row = findActiveRow(await loadRows());
    } catch (error) {
      await recordReconciliationFailure({ organizationId, providerSubscriptionId });
      console.error("Failed to reconcile an expired billing subscription.", {
        error,
        organizationId,
        providerSubscriptionId,
      });
      return null;
    }
  }

  return row && row.currentPeriodEnd > new Date() ? toBillingAccount(row, organizationId) : null;
};

export const hasUnlimitedBillingAccess = async (userId: string) =>
  isLocalDevelopmentBillingEntitlementEnabled() || !!(await getActiveOverride(userId));

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
}): Promise<BillingEntitlement> => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return localDevelopmentBillingEntitlement();
  }

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
