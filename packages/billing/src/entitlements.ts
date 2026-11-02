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
  subscription: Pick<
    SubscriptionRow,
    "cancelAtPeriodEnd" | "currentPeriodEnd" | "status"
  >,
  now = new Date()
) =>
  isActiveBillingStatus(subscription.status) &&
  (subscription.currentPeriodEnd > now ||
    (subscription.status === "active" && !subscription.cancelAtPeriodEnd));

export type BillingAccount = {
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
  plan: StoredBillingPlan;
  provider: "polar";
  providerCustomerId: string | null;
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
    billingOwnerUserId: row.userId,
    creditAmountCents: BILLING_PRODUCTS[parsedProduct.data].creditAmountCents,
    currentPeriodEnd: row.currentPeriodEnd,
    currentPeriodStart: row.currentPeriodStart,
    externalCustomerId:
      row.metadata?.quieterScope === "account"
        ? getBillingExternalIdentity("user", row.userId)
        : getBillingExternalIdentity(
            "organization",
            row.metadata?.quieterOrganizationId ??
              row.organizationId ??
              organizationId
          ),
    organizationId,
    product: parsedProduct.data,
    providerSubscriptionId: row.providerSubscriptionId,
    scope: row.scope,
  };
};

export const getOrganizationBillingOwnerId = async (organizationId: string) => {
  const [current] = await db
    .select({ billingOwnerUserId: organization.billingOwnerUserId })
    .from(organization)
    .where(eq(organization.id, organizationId))
    .limit(1);
  if (current === undefined) {
    return null;
  }
  if ((current.billingOwnerUserId ?? "") !== "") {
    return current.billingOwnerUserId;
  }

  return await db.transaction(async (transaction) => {
    const [record] = await transaction
      .select({ billingOwnerUserId: organization.billingOwnerUserId })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)
      .for("update");

    if (record === undefined) {
      return null;
    }
    if ((record.billingOwnerUserId ?? "") !== "") {
      return record.billingOwnerUserId;
    }

    const [owner] = await transaction
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

    const [assigned] = await transaction
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
  });
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
  target:
    | { scope: "team"; organizationId: string }
    | {
        scope: "account";
        userId: string;
        selectedSubscriptionId: string | null;
      },
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
        plan: billingSubscription.plan,
        provider: billingSubscription.provider,
        providerCustomerId: billingSubscription.providerCustomerId,
        providerModifiedAt: billingSubscription.providerModifiedAt,
        providerSubscriptionId: billingSubscription.providerSubscriptionId,
        scope: billingSubscription.scope,
        status: billingSubscription.status,
        updatedAt: billingSubscription.updatedAt,
        userId: billingSubscription.userId,
      })
      .from(billingSubscription)
      .where(
        and(
          target.scope === "team"
            ? and(
                eq(billingSubscription.organizationId, target.organizationId),
                eq(billingSubscription.scope, "team")
              )
            : and(
                eq(billingSubscription.userId, target.userId),
                target.selectedSubscriptionId === null
                  ? eq(billingSubscription.scope, "account")
                  : eq(billingSubscription.id, target.selectedSubscriptionId)
              ),
          inArray(billingSubscription.plan, ["managed", "pro"])
        )
      )
      .orderBy(desc(billingSubscription.updatedAt));

  const findSubscription = (rows: Awaited<ReturnType<typeof loadRows>>) => {
    const ownedRows = rows.filter((candidate) =>
      target.scope === "team"
        ? subscriptionBelongsToOrganization(
            candidate.metadata,
            target.organizationId
          )
        : candidate.metadata?.quieterUserId === target.userId &&
          (candidate.id === target.selectedSubscriptionId ||
            candidate.metadata.quieterScope === "account")
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
          return target.scope === "account"
            ? { ...row, scope: "account" as const }
            : row;
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
  return target.scope === "account"
    ? { ...row, scope: "account" as const }
    : row;
};

export const getAccountSubscriptionRecord = async (
  userId: string,
  options: { forceReconcile?: boolean } = {}
) => {
  const [settings] = await db
    .select({
      selectedSubscriptionId: billingAccountSettings.selectedSubscriptionId,
    })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId))
    .limit(1);
  return await getSubscriptionRecord(
    {
      scope: "account",
      selectedSubscriptionId: settings?.selectedSubscriptionId ?? null,
      userId,
    },
    options
  );
};

export const getOrganizationSubscriptionRecord = async (
  organizationId: string,
  options: { forceReconcile?: boolean } = {}
) => {
  const ownerId = await getOrganizationBillingOwnerId(organizationId);
  if (ownerId !== null) {
    const account = await getAccountSubscriptionRecord(ownerId, options);
    if (account !== null) {
      return account;
    }
  }
  return await getSubscriptionRecord(
    { organizationId, scope: "team" },
    options
  );
};

export const getAccountBillingEntitlement = async (userId: string) => {
  if (isLocalDevelopmentBillingEntitlementEnabled()) {
    return localDevelopmentBillingEntitlement();
  }
  const subscription = await getAccountSubscriptionRecord(userId);
  const account =
    subscription !== null && isActiveBillingSubscription(subscription)
      ? toBillingAccount(subscription, subscription.organizationId ?? "")
      : null;
  const override = await getActiveOverride(userId);
  return {
    account: override === null ? account : null,
    hasAccess: override !== null || account !== null,
    hasUnlimitedAccess: override !== null,
    product: override === null ? (account?.product ?? null) : "pro",
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

export const organizationHasBillingFeature = async (input: {
  feature: BillingFeature;
  organizationId: string;
}) => {
  const entitlement = await getOrganizationBillingEntitlement(input);
  return entitlement.hasAccess;
};
