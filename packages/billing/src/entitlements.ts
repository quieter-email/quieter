import { ORPCError } from "@orpc/server";
import {
  PolarNetworkError,
  PolarRateLimitError,
  PolarServerError,
} from "@polar-sh/sdk";
import { db } from "@quieter/database/client";
import {
  billingEntitlementOverride,
  billingAccountSettings,
  user,
  billingSubscription,
  member,
  organization,
} from "@quieter/database/schema";
import type {
  BillingPlan as StoredBillingPlan,
  BillingSubscriptionStatus,
  BillingScope,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { reportError } from "@quieter/observability";
import { and, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

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
  subscription: Pick<
    SubscriptionRow,
    "cancelAtPeriodEnd" | "currentPeriodEnd" | "status"
  >,
  now = new Date()
) =>
  isActiveBillingStatus(subscription.status) &&
  subscription.currentPeriodEnd > now;

export type BillingAccount = {
  authorizedCostMicroCents?: number | null;
  billingOwnerUserId?: string;
  creditAmountCents: number;
  currentPeriodEnd: Date;
  currentPeriodStart: Date;
  externalCustomerId: string;
  organizationId: string;
  product: BillingProductId;
  providerSubscriptionId?: string;
  scope?: BillingScope;
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
  id: string;
  metadata: Record<string, string> | null;
  organizationId: string | null;
  periodCreditAmountCents: number | null;
  plan: StoredBillingPlan;
  provider: "polar";
  providerCustomerId: string | null;
  providerProductId: string | null;
  providerModifiedAt: Date | null;
  providerSubscriptionId: string;
  status: BillingSubscriptionStatus;
  scope: BillingScope;
  updatedAt: Date;
  userId: string;
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

export const getActiveOverride = async (userId: string) => {
  const [override] = await db
    .select({ plan: billingEntitlementOverride.plan })
    .from(billingEntitlementOverride)
    .innerJoin(user, eq(user.id, billingEntitlementOverride.userId))
    .leftJoin(
      billingAccountSettings,
      eq(billingAccountSettings.userId, user.id)
    )
    .where(
      and(
        eq(billingEntitlementOverride.userId, userId),
        isNull(billingAccountSettings.deletionRequestedAt),
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
    billingOwnerUserId: row.userId,
    creditAmountCents:
      row.periodCreditAmountCents ??
      BILLING_PRODUCTS[parsedProduct.data].creditAmountCents,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    externalCustomerId: getBillingExternalIdentity("user", row.userId),
    organizationId,
    product: parsedProduct.data,
    providerSubscriptionId: row.providerSubscriptionId,
    scope: row.scope,
  };
};

export const getOrganizationBillingOwnerId = async (organizationId: string) => {
  const [owner] = await db
    .select({ userId: member.userId })
    .from(organization)
    .innerJoin(
      member,
      and(
        eq(member.organizationId, organization.id),
        eq(member.userId, organization.billingOwnerUserId),
        sql`'owner' = any(string_to_array(${member.role}, ','))`
      )
    )
    .innerJoin(user, eq(user.id, member.userId))
    .leftJoin(
      billingAccountSettings,
      eq(billingAccountSettings.userId, user.id)
    )
    .where(
      and(
        eq(organization.id, organizationId),
        isNull(organization.billingDeletionRequestedAt),
        isNull(billingAccountSettings.deletionRequestedAt)
      )
    )
    .limit(1);
  return owner?.userId ?? null;
};

const recordReconciliationFailure = async ({
  allowCachedAccess,
  id,
  providerModifiedAt,
  providerSubscriptionId,
  updatedAt,
}: {
  allowCachedAccess: boolean;
  id: string;
  providerModifiedAt: Date | null;
  providerSubscriptionId: string;
  updatedAt: Date;
}) => {
  try {
    await db
      .update(billingSubscription)
      .set({
        lastReconciliationFailureAt: allowCachedAccess ? null : new Date(),
        ...(allowCachedAccess ? { updatedAt: new Date() } : {}),
      })
      .where(
        and(
          eq(billingSubscription.id, id),
          eq(billingSubscription.provider, "polar"),
          eq(
            billingSubscription.providerSubscriptionId,
            providerSubscriptionId
          ),
          providerModifiedAt === null
            ? isNull(billingSubscription.providerModifiedAt)
            : eq(billingSubscription.providerModifiedAt, providerModifiedAt),
          ...(allowCachedAccess
            ? [
                eq(billingSubscription.updatedAt, updatedAt),
                isNull(billingSubscription.lastReconciliationFailureAt),
              ]
            : [])
        )
      );
  } catch (error) {
    reportError(error, { operation: "billing:record-reconciliation-failure" });
  }
};

const getSubscriptionRecord = async (
  target: { userId: string },
  options: { forceReconcile?: boolean } = {}
) => {
  const loadRows = () =>
    db
      .select({
        cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
        currentPeriodEnd: billingSubscription.currentPeriodEnd,
        currentPeriodStart: billingSubscription.currentPeriodStart,
        id: billingSubscription.id,
        lastReconciliationFailureAt:
          billingSubscription.lastReconciliationFailureAt,
        metadata: billingSubscription.metadata,
        organizationId: billingSubscription.organizationId,
        periodCreditAmountCents: billingSubscription.periodCreditAmountCents,
        plan: billingSubscription.plan,
        provider: billingSubscription.provider,
        providerCustomerId: billingSubscription.providerCustomerId,
        providerModifiedAt: billingSubscription.providerModifiedAt,
        providerProductId: billingSubscription.providerProductId,
        providerSubscriptionId: billingSubscription.providerSubscriptionId,
        scope: billingSubscription.scope,
        status: billingSubscription.status,
        updatedAt: billingSubscription.updatedAt,
        userId: billingSubscription.userId,
      })
      .from(billingSubscription)
      .where(
        and(
          eq(billingSubscription.userId, target.userId),
          eq(billingSubscription.scope, "account"),
          inArray(billingSubscription.plan, ["managed", "pro"])
        )
      )
      .orderBy(desc(billingSubscription.updatedAt));

  const findSubscription = (rows: Awaited<ReturnType<typeof loadRows>>) => {
    const ownedRows = rows.filter(
      (candidate) =>
        candidate.metadata?.quieterUserId === target.userId &&
        candidate.scope === "account" &&
        candidate.metadata.quieterScope === "account" &&
        candidate.metadata.quieterProduct === candidate.plan &&
        candidate.organizationId === null &&
        candidate.providerCustomerId !== null &&
        candidate.providerProductId ===
          (candidate.plan === "managed"
            ? serverEnv.POLAR_PRODUCT_MANAGED_ID
            : serverEnv.POLAR_PRODUCT_PRO_ID)
    );
    return (
      ownedRows.find(
        (candidate) =>
          isActiveBillingStatus(candidate.status) &&
          candidate.currentPeriodEnd > new Date()
      ) ??
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
    let providerUnavailable = false;
    try {
      const [{ getPolarClient }, { syncBillingSubscription }] =
        await Promise.all([
          import("./polar.ts"),
          import("./subscription-sync.ts"),
        ]);
      const polar = await getPolarClient();
      const subscription = await polar.subscriptions
        .get(providerSubscriptionId, {
          timeout: BILLING_RECONCILIATION_TIMEOUT_MS / 1000,
        })
        .catch((error: unknown) => {
          providerUnavailable =
            error instanceof PolarNetworkError ||
            error instanceof PolarServerError ||
            error instanceof PolarRateLimitError;
          throw error;
        });
      if (
        subscription.customer_id !== row.providerCustomerId ||
        subscription.metadata.quieterUserId !== row.userId ||
        (row.metadata?.quieterScope === "account"
          ? subscription.metadata.quieterScope !== "account"
          : subscription.metadata.quieterOrganizationId !==
            row.metadata?.quieterOrganizationId)
      ) {
        throw new Error(
          "The subscription belongs to a different billing account."
        );
      }
      const syncResult = await syncBillingSubscription(subscription);
      if (!syncResult.synced || syncResult.ignored === true) {
        throw new Error("The subscription could not be reconciled.");
      }
      row = findSubscription(await loadRows());
    } catch (error) {
      const allowCachedAccess =
        providerUnavailable &&
        row.lastReconciliationFailureAt === null &&
        isActiveBillingStatus(row.status) &&
        row.currentPeriodEnd > new Date();
      await recordReconciliationFailure({
        allowCachedAccess,
        id: row.id,
        providerModifiedAt: row.providerModifiedAt,
        providerSubscriptionId,
        updatedAt: row.updatedAt,
      });
      reportError(error, {
        operation: "billing:reconcile-subscription",
      });
      if (allowCachedAccess) {
        row = findSubscription(await loadRows());
        if (
          row?.lastReconciliationFailureAt === null &&
          isActiveBillingStatus(row.status) &&
          row.currentPeriodEnd > new Date()
        ) {
          return row;
        }
      }
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

  if (row === undefined) {
    return null;
  }
  return row;
};

export const getAccountSubscriptionRecord = async (
  userId: string,
  options: { forceReconcile?: boolean } = {}
) => {
  const [settings] = await db
    .select({ deletionRequestedAt: billingAccountSettings.deletionRequestedAt })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId))
    .limit(1);
  if (settings !== undefined && settings.deletionRequestedAt !== null) {
    return null;
  }
  return await getSubscriptionRecord({ userId }, options);
};

export const getOrganizationSubscriptionRecord = async (
  organizationId: string,
  options: { forceReconcile?: boolean } = {}
) => {
  const ownerId = await getOrganizationBillingOwnerId(organizationId);
  return ownerId === null
    ? null
    : await getAccountSubscriptionRecord(ownerId, options);
};

export const getAccountBillingEntitlement = async (userId: string) => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return localDevelopmentBillingEntitlement();
  }
  const [closing] = await db
    .select({ deletionRequestedAt: billingAccountSettings.deletionRequestedAt })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId))
    .limit(1);
  if (closing?.deletionRequestedAt) {
    return {
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    } satisfies BillingEntitlement;
  }
  const override = await getActiveOverride(userId);
  if (override !== null) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "pro",
    } satisfies BillingEntitlement;
  }
  const subscription = await getAccountSubscriptionRecord(userId);
  const account =
    subscription !== null && isActiveBillingSubscription(subscription)
      ? toBillingAccount(subscription, subscription.organizationId ?? "")
      : null;
  return {
    account,
    hasAccess: account !== null,
    hasUnlimitedAccess: false,
    product: account?.product ?? null,
  } satisfies BillingEntitlement;
};

export const getOrganizationSubscription = async (organizationId: string) => {
  const row = await getOrganizationSubscriptionRecord(organizationId);
  return row !== null && isActiveBillingSubscription(row)
    ? toBillingAccount(row, organizationId)
    : null;
};

export const getOrganizationBillingEntitlement = async (input: {
  feature: BillingFeature;
  organizationId: string;
  subscription?: SubscriptionRow | null;
}): Promise<BillingEntitlement> => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return localDevelopmentBillingEntitlement();
  }

  const billingOwnerId = await getOrganizationBillingOwnerId(
    input.organizationId
  );
  if (billingOwnerId === null) {
    return {
      account: null,
      hasAccess: false,
      hasUnlimitedAccess: false,
      product: null,
    };
  }
  if ((await getActiveOverride(billingOwnerId)) !== null) {
    return {
      account: null,
      hasAccess: true,
      hasUnlimitedAccess: true,
      product: "pro",
    };
  }
  const subscription =
    input.subscription === undefined
      ? await getAccountSubscriptionRecord(billingOwnerId)
      : input.subscription;
  const account =
    subscription !== null &&
    subscription.scope === "account" &&
    subscription.userId === billingOwnerId &&
    subscription.metadata?.quieterScope === "account" &&
    subscription.metadata.quieterUserId === billingOwnerId &&
    subscription.organizationId === null &&
    subscription.metadata.quieterProduct === subscription.plan &&
    subscription.providerCustomerId !== null &&
    subscription.providerProductId ===
      (subscription.plan === "managed"
        ? serverEnv.POLAR_PRODUCT_MANAGED_ID
        : serverEnv.POLAR_PRODUCT_PRO_ID) &&
    isActiveBillingSubscription(subscription)
      ? toBillingAccount(subscription, input.organizationId)
      : null;
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

export const organizationHasBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement(input);
  return entitlement.hasAccess;
};
