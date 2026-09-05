import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  billingEntitlementOverride,
  billingSubscription,
  member,
  organization,
} from "@quieter/database/schema";
import type {
  BillingPlan as StoredBillingPlan,
  BillingSubscriptionStatus,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import {
  BILLING_FEATURES,
  BILLING_PRODUCTS,
  billingProductIdSchema,
  productHasAi,
  productHasManagedMail,
} from "./plans.ts";
import type { BillingFeature, BillingProductId } from "./plans.ts";
import { getBillingExternalIdentity } from "./polar-config.ts";

const ACTIVE_BILLING_STATUSES = new Set<BillingSubscriptionStatus>([
  "active",
  "trialing",
]);

export const isActiveBillingStatus = (status: BillingSubscriptionStatus) =>
  ACTIVE_BILLING_STATUSES.has(status);

export const isActiveBillingSubscription = (
  subscription: Pick<SubscriptionRow, "currentPeriodEnd" | "status">,
  now = new Date()
) =>
  isActiveBillingStatus(subscription.status) &&
  subscription.currentPeriodEnd > now;

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
  | "BETTER_AUTH_URL"
  | "NODE_ENV"
  | "QUIETER_DEPLOYMENT_ENV"
  | "QUIETER_LOCAL_BILLING_BYPASS"
>;

const isLoopbackUrl = (value = "") => {
  if (value === "") {
    return false;
  }
  const hostname = new URL(value).hostname.replace(
    /^\[(?<hostname>.*)\]$/u,
    "$<hostname>"
  );
  return (
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
  );
};

export const isLocalDevelopmentBillingEntitlementEnabled = (
  env: BillingRuntimeEnvironment = serverEnv
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
  cancelAtPeriodEnd: boolean;
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
const BILLING_RECONCILIATION_TIMEOUT_MS = 5000;

export const shouldReconcileBillingSubscription = (
  row: Pick<
    SubscriptionRow,
    "currentPeriodEnd" | "lastReconciliationFailureAt" | "updatedAt"
  >,
  now = new Date()
) => {
  const lastAttemptAt = row.lastReconciliationFailureAt ?? row.updatedAt;

  return (
    (row.currentPeriodEnd <= now && lastAttemptAt < row.currentPeriodEnd) ||
    now.getTime() - lastAttemptAt.getTime() >=
      BILLING_RECONCILIATION_INTERVAL_MS
  );
};

export const subscriptionBelongsToOrganization = (
  metadata: Record<string, string> | null,
  organizationId: string
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
          gt(billingEntitlementOverride.expiresAt, new Date())
        )
      )
    )
    .orderBy(desc(billingEntitlementOverride.updatedAt))
    .limit(1);

  return override ?? null;
};

const toBillingAccount = (
  row: SubscriptionRow,
  organizationId: string
): BillingAccount | null => {
  const parsedProduct = billingProductIdSchema.safeParse(row.plan);
  if (!parsedProduct.success) {
    return null;
  }

  return {
    creditAmountCents: BILLING_PRODUCTS[parsedProduct.data].creditAmountCents,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    externalCustomerId: getBillingExternalIdentity(
      "organization",
      organizationId
    ),
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

  if ((record?.billingOwnerUserId ?? "") !== "") {
    return record.billingOwnerUserId;
  }

  const [owner] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(
      and(eq(member.organizationId, organizationId), eq(member.role, "owner"))
    )
    .orderBy(asc(member.createdAt))
    .limit(1);
  if (owner === undefined) {
    return null;
  }

  const [assigned] = await db
    .update(organization)
    .set({ billingOwnerUserId: owner.userId, updatedAt: new Date() })
    .where(
      and(
        eq(organization.id, organizationId),
        isNull(organization.billingOwnerUserId)
      )
    )
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
          eq(billingSubscription.providerSubscriptionId, providerSubscriptionId)
        )
      );
  } catch (error) {
    reportError(error, { operation: "billing:record-reconciliation-failure" });
  }
};

export const getOrganizationSubscriptionRecord = async (
  organizationId: string,
  options: { forceReconcile?: boolean } = {}
) => {
  const loadRows = () =>
    db
      .select({
        cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
        currentPeriodEnd: billingSubscription.currentPeriodEnd,
        currentPeriodStart: billingSubscription.currentPeriodStart,
        lastReconciliationFailureAt:
          billingSubscription.lastReconciliationFailureAt,
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
          inArray(billingSubscription.plan, ["managed", "pro"])
        )
      )
      .orderBy(desc(billingSubscription.updatedAt));

  const findSubscription = (rows: Awaited<ReturnType<typeof loadRows>>) => {
    const ownedRows = rows.filter((candidate) =>
      subscriptionBelongsToOrganization(candidate.metadata, organizationId)
    );
    return (
      ownedRows.find((candidate) => isActiveBillingSubscription(candidate)) ??
      ownedRows.find((candidate) => isActiveBillingStatus(candidate.status)) ??
      ownedRows[0]
    );
  };

  let row = findSubscription(await loadRows());
  if (row === undefined) {
    return null;
  }

  if (
    row.provider === "polar" &&
    (options.forceReconcile === true || shouldReconcileBillingSubscription(row))
  ) {
    const { providerSubscriptionId } = row;
    try {
      const [{ getPolarClient }, { syncBillingSubscription }] =
        await Promise.all([
          import("./polar.ts"),
          import("./subscription-sync.ts"),
        ]);
      const polar = await getPolarClient();
      const subscription = await polar.subscriptions.get(
        { id: providerSubscriptionId },
        { signal: AbortSignal.timeout(BILLING_RECONCILIATION_TIMEOUT_MS) }
      );
      const syncResult = await syncBillingSubscription(subscription);
      if (!syncResult.synced) {
        throw new Error("The subscription could not be reconciled.");
      }
      row = findSubscription(await loadRows());
    } catch (error) {
      await recordReconciliationFailure({
        organizationId,
        providerSubscriptionId,
      });
      reportError(error, {
        operation: "billing:reconcile-subscription",
      });
      throw new ORPCError("SERVICE_UNAVAILABLE", {
        message: "Could not check billing access. Please try again.",
      });
    }
  }

  if (
    row?.lastReconciliationFailureAt !== null &&
    row?.lastReconciliationFailureAt !== undefined
  ) {
    throw new ORPCError("SERVICE_UNAVAILABLE", {
      message: "Could not check billing access. Please try again.",
    });
  }

  return row ?? null;
};

export const getOrganizationSubscription = async (organizationId: string) => {
  const row = await getOrganizationSubscriptionRecord(organizationId);
  return row !== null && isActiveBillingSubscription(row)
    ? toBillingAccount(row, organizationId)
    : null;
};

export const hasUnlimitedBillingAccess = async (userId: string) =>
  isLocalDevelopmentBillingEntitlementEnabled() ||
  (await getActiveOverride(userId)) !== null;

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
  subscription?: SubscriptionRow | null;
}): Promise<BillingEntitlement> => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return localDevelopmentBillingEntitlement();
  }

  let account: BillingAccount | null = null;
  if (input.subscription === undefined) {
    account = await getOrganizationSubscription(input.organizationId);
  } else if (
    input.subscription !== null &&
    isActiveBillingSubscription(input.subscription)
  ) {
    account = toBillingAccount(input.subscription, input.organizationId);
  }
  const billingOwnerId = await getOrganizationBillingOwnerId(
    input.organizationId
  );
  let activeOverride = null;
  if (typeof billingOwnerId === "string" && billingOwnerId !== "") {
    activeOverride = await getActiveOverride(billingOwnerId);
  }
  const hasUnlimitedAccess = activeOverride !== null;

  if (hasUnlimitedAccess) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "pro",
    };
  }

  const hasAccess =
    account !== null &&
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
    .where(
      and(
        eq(member.userId, input.userId),
        eq(member.organizationId, input.organizationId)
      )
    )
    .limit(1);

  if (membership === undefined) {
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
}) => {
  const entitlement = await getOrganizationBillingEntitlement(input);
  return entitlement.hasAccess;
};
