import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingAccountSettings,
  billingCreditUsageEvent,
  billingSubscription,
  organization,
  organizationMailSendIdempotency,
  user,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";

import { isActiveBillingSubscription } from "./entitlements.ts";

export const getAccountUsageSettings = async (
  userId: string,
  client: Pick<typeof db, "select"> = db
) => {
  const [settings] = await client
    .select({
      monthlyOverageLimitMicroCents:
        billingAccountSettings.monthlyOverageLimitMicroCents,
      overageEnabled: billingAccountSettings.overageEnabled,
    })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId))
    .limit(1);
  return (
    settings ?? { monthlyOverageLimitMicroCents: null, overageEnabled: false }
  );
};

export const updateAccountUsageSettings = async (input: {
  monthlyOverageLimitMicroCents: number | null;
  overageEnabled: boolean;
  userId: string;
}) => {
  await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    await transaction
      .insert(billingAccountSettings)
      .values({
        ...input,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        set: {
          monthlyOverageLimitMicroCents: input.monthlyOverageLimitMicroCents,
          overageEnabled: input.overageEnabled,
          updatedAt: new Date(),
        },
        target: billingAccountSettings.userId,
      });
  });
};

export const getLegacyAccountSubscriptions = async (userId: string) =>
  await db
    .select({
      cancelAtPeriodEnd: billingSubscription.cancelAtPeriodEnd,
      currentPeriodEnd: billingSubscription.currentPeriodEnd,
      currentPeriodStart: billingSubscription.currentPeriodStart,
      id: billingSubscription.id,
      metadata: billingSubscription.metadata,
      organizationId: organization.id,
      organizationName: organization.name,
      plan: billingSubscription.plan,
      providerCustomerId: billingSubscription.providerCustomerId,
      providerSubscriptionId: billingSubscription.providerSubscriptionId,
      status: billingSubscription.status,
    })
    .from(billingSubscription)
    .innerJoin(
      organization,
      eq(organization.id, billingSubscription.organizationId)
    )
    .where(
      and(
        eq(billingSubscription.userId, userId),
        eq(organization.billingOwnerUserId, userId),
        eq(billingSubscription.scope, "team"),
        inArray(billingSubscription.plan, ["managed", "pro"]),
        inArray(billingSubscription.status, [
          "active",
          "trialing",
          "past_due",
          "pending",
        ]),
        eq(
          sql<string>`${billingSubscription.metadata}->>'quieterUserId'`,
          userId
        ),
        eq(
          sql<string>`${billingSubscription.metadata}->>'quieterOrganizationId'`,
          organization.id
        )
      )
    )
    .orderBy(desc(billingSubscription.updatedAt));

export const useAccountBillingPlan = async (input: {
  subscriptionId: string;
  userId: string;
}) => {
  const subscriptions = await getLegacyAccountSubscriptions(input.userId);
  const candidate = subscriptions.find(
    (subscription) => subscription.id === input.subscriptionId
  );
  if (candidate === undefined) {
    throw new ORPCError("NOT_FOUND", {
      message: "This subscription is unavailable.",
    });
  }
  const [{ getPolarClient }, { syncBillingSubscription }] = await Promise.all([
    import("./polar.ts"),
    import("./subscription-sync.ts"),
  ]);
  const polar = await getPolarClient();
  const subscription = await polar.subscriptions.get(
    candidate.providerSubscriptionId
  );
  if (
    subscription.metadata.quieterUserId !== input.userId ||
    subscription.metadata.quieterOrganizationId !== candidate.organizationId
  ) {
    throw new ORPCError("FORBIDDEN", {
      message: "This subscription belongs to a different billing account.",
    });
  }
  const sync = await syncBillingSubscription(subscription);
  if (!sync.synced || sync.ignored === true) {
    throw new ORPCError("BAD_REQUEST", {
      message: "We could not verify this subscription. Please try again.",
    });
  }
  return await db.transaction(async (transaction) => {
    await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, input.userId))
      .for("update");
    const [settings] = await transaction
      .select()
      .from(billingAccountSettings)
      .where(eq(billingAccountSettings.userId, input.userId));
    if (settings?.selectedSubscriptionId === input.subscriptionId) {
      return { activated: true };
    }
    if (settings !== undefined && settings.selectedSubscriptionId !== null) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Your account already uses a plan. Open Manage billing to change it.",
      });
    }
    const ownedOrganizations = await transaction
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.billingOwnerUserId, input.userId))
      .orderBy(asc(organization.id))
      .for("update");
    const [selected] = await transaction
      .select()
      .from(billingSubscription)
      .where(
        and(
          eq(billingSubscription.id, input.subscriptionId),
          eq(billingSubscription.userId, input.userId)
        )
      )
      .for("update");
    if (
      selected === undefined ||
      selected.organizationId === null ||
      !ownedOrganizations.some((item) => item.id === selected.organizationId) ||
      !isActiveBillingSubscription(selected)
    ) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Choose an active subscription for your account.",
      });
    }
    const legacyOrganizations = await transaction
      .selectDistinct({ id: organization.id })
      .from(organization)
      .innerJoin(
        billingSubscription,
        eq(billingSubscription.organizationId, organization.id)
      )
      .where(
        and(
          eq(organization.billingOwnerUserId, input.userId),
          eq(billingSubscription.userId, input.userId),
          eq(billingSubscription.scope, "team")
        )
      );
    const ids = legacyOrganizations.map((item) => item.id);
    if (ids.length > 0) {
      await transaction
        .update(billingCreditUsageEvent)
        .set({
          externalCustomerId: sql`coalesce(${billingCreditUsageEvent.externalCustomerId}, ${serverEnv.QUIETER_DEPLOYMENT_ENV === "local" ? "local:organization:" : "organization:"} || ${billingCreditUsageEvent.organizationId})`,
          userId: input.userId,
        })
        .where(
          and(
            inArray(billingCreditUsageEvent.organizationId, ids),
            isNull(billingCreditUsageEvent.userId),
            gte(billingCreditUsageEvent.createdAt, selected.currentPeriodStart),
            selected.currentPeriodEnd > new Date()
              ? lt(billingCreditUsageEvent.createdAt, selected.currentPeriodEnd)
              : undefined
          )
        );
      await transaction
        .update(aiCreditReservation)
        .set({ billingUserId: input.userId })
        .where(
          and(
            inArray(aiCreditReservation.organizationId, ids),
            isNull(aiCreditReservation.billingUserId),
            eq(aiCreditReservation.status, "reserved")
          )
        );
      await transaction
        .update(organizationMailSendIdempotency)
        .set({ billingUserId: input.userId })
        .where(
          and(
            inArray(organizationMailSendIdempotency.organizationId, ids),
            isNull(organizationMailSendIdempotency.billingUserId),
            inArray(organizationMailSendIdempotency.status, [
              "prepared",
              "submitting",
              "accepted",
              "unknown",
            ])
          )
        );
    }
    const now = new Date();
    await transaction
      .insert(billingAccountSettings)
      .values({
        activatedAt: now,
        selectedSubscriptionId: selected.id,
        updatedAt: now,
        userId: input.userId,
      })
      .onConflictDoUpdate({
        set: {
          activatedAt: now,
          selectedSubscriptionId: selected.id,
          updatedAt: now,
        },
        target: billingAccountSettings.userId,
      });
    return { activated: true };
  });
};
