import type { Polar } from "@polar-sh/sdk/2026-04";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingAccountSettings,
  billingCreditUsageEvent,
  billingSubscription,
  member,
  organization,
  organizationMailSendIdempotency,
  organizationMailUsageEvent,
  user,
} from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import { and, asc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";

import { recoverBillingCheckout } from "./checkout-recovery.ts";
import { getBillingExternalIdentity } from "./polar-config.ts";
import { getPolarClient } from "./polar.ts";
import { syncBillingSubscription } from "./subscription-sync.ts";

const getUnresolvedFinancialWork = async (
  transaction: DatabaseTransaction,
  target: { organizationId: string } | { userId: string }
) => {
  const [reservation] = await transaction
    .select({ id: aiCreditReservation.id })
    .from(aiCreditReservation)
    .where(
      and(
        "organizationId" in target
          ? eq(aiCreditReservation.organizationId, target.organizationId)
          : eq(aiCreditReservation.billingUserId, target.userId),
        eq(aiCreditReservation.status, "reserved")
      )
    )
    .limit(1);
  if (reservation !== undefined) {
    return "Wait for pending AI work to finish before deleting. Then try again.";
  }
  const [send] = await transaction
    .select({ id: organizationMailSendIdempotency.id })
    .from(organizationMailSendIdempotency)
    .where(
      and(
        "organizationId" in target
          ? eq(
              organizationMailSendIdempotency.organizationId,
              target.organizationId
            )
          : eq(organizationMailSendIdempotency.billingUserId, target.userId),
        inArray(organizationMailSendIdempotency.status, [
          "pending",
          "prepared",
          "submitting",
          "accepted",
          "unknown",
        ])
      )
    )
    .limit(1);
  if (send !== undefined) {
    return "Wait for pending mail deliveries to be resolved before deleting. Then try again.";
  }
  const [event] = await transaction
    .select({ id: billingCreditUsageEvent.id })
    .from(billingCreditUsageEvent)
    .where(
      and(
        "organizationId" in target
          ? or(
              eq(billingCreditUsageEvent.organizationId, target.organizationId),
              eq(
                billingCreditUsageEvent.sourceOrganizationId,
                target.organizationId
              )
            )
          : eq(billingCreditUsageEvent.userId, target.userId),
        gt(billingCreditUsageEvent.billableCostMicroCents, 0),
        isNull(billingCreditUsageEvent.polarEventReportedAt)
      )
    )
    .limit(1);
  if (event !== undefined) {
    return "Outstanding usage charges must be reconciled before deleting. Please try again later or contact support.";
  }
  if ("organizationId" in target) {
    const [mailEvent] = await transaction
      .select({ id: organizationMailUsageEvent.id })
      .from(organizationMailUsageEvent)
      .where(
        and(
          eq(organizationMailUsageEvent.organizationId, target.organizationId),
          gt(organizationMailUsageEvent.billableCostMicroCents, 0),
          isNull(organizationMailUsageEvent.polarEventReportedAt),
          sql`not exists (select 1 from ${billingCreditUsageEvent}
            where ${billingCreditUsageEvent.dedupeKey} = 'mail:' || ${organizationMailUsageEvent.dedupeKey})`
        )
      )
      .limit(1);
    if (mailEvent !== undefined) {
      return "Outstanding mail charges must be reconciled before deleting. Please try again later or contact support.";
    }
  }
  return null;
};

const closeAccountForDeletion = async (userId: string) =>
  await db.transaction(async (transaction) => {
    const [payer] = await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, userId))
      .for("update");
    if (payer === undefined) {
      return null;
    }
    const fundedTeams = await transaction
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.billingOwnerUserId, userId))
      .orderBy(asc(organization.id))
      .for("update");
    for (const team of fundedTeams) {
      const [otherMember] = await transaction
        .select({ id: member.id })
        .from(member)
        .where(
          and(eq(member.organizationId, team.id), ne(member.userId, userId))
        )
        .limit(1);
      if (otherMember !== undefined) {
        return "Transfer billing for shared teams to another owner before deleting your account.";
      }
    }
    const now = new Date();
    await transaction
      .insert(billingAccountSettings)
      .values({ deletionRequestedAt: now, updatedAt: now, userId })
      .onConflictDoUpdate({
        set: { deletionRequestedAt: now, updatedAt: now },
        target: billingAccountSettings.userId,
      });
    for (const team of fundedTeams) {
      await transaction
        .update(organization)
        .set({ billingDeletionRequestedAt: now })
        .where(eq(organization.id, team.id));
    }
    const accountFailure = await getUnresolvedFinancialWork(transaction, {
      userId,
    });
    if (accountFailure !== null) {
      return accountFailure;
    }
    for (const team of fundedTeams) {
      const failure = await getUnresolvedFinancialWork(transaction, {
        organizationId: team.id,
      });
      if (failure !== null) {
        return failure;
      }
    }
    return null;
  });

const confirmProviderAccountClosed = async (userId: string) => {
  const subscriptions = await db
    .select({
      customerId: billingSubscription.providerCustomerId,
      subscriptionId: billingSubscription.providerSubscriptionId,
    })
    .from(billingSubscription)
    .where(eq(billingSubscription.userId, userId));
  const [settings] = await db
    .select({
      activatedAt: billingAccountSettings.activatedAt,
      checkoutId: billingAccountSettings.checkoutId,
    })
    .from(billingAccountSettings)
    .where(eq(billingAccountSettings.userId, userId));
  const usage = await db
    .selectDistinct({
      externalCustomerId: billingCreditUsageEvent.externalCustomerId,
    })
    .from(billingCreditUsageEvent)
    .where(
      and(
        eq(billingCreditUsageEvent.userId, userId),
        gt(billingCreditUsageEvent.billableCostMicroCents, 0)
      )
    );
  if (
    subscriptions.length === 0 &&
    (settings?.activatedAt === null || settings?.activatedAt === undefined) &&
    (settings?.checkoutId === null || settings?.checkoutId === undefined) &&
    usage.length === 0
  ) {
    return null;
  }
  const cancellationMessage =
    "Cancel all subscriptions before deleting your account. If cancellation is scheduled, wait until it takes effect or cancel immediately.";
  try {
    const deadline = Date.now() + 15_000;
    const polar = await getPolarClient();
    const customers = new Set<string>();
    for (const subscription of subscriptions) {
      if (subscription.customerId !== null) {
        customers.add(subscription.customerId);
      }
      const remaining = (deadline - Date.now()) / 1000;
      if (remaining <= 0) {
        throw new Error("Account deletion billing confirmation timed out.");
      }
      const current = await polar.subscriptions.get(
        subscription.subscriptionId,
        { timeout: remaining }
      );
      customers.add(current.customer_id);
      if (
        current.status !== "canceled" &&
        current.status !== "incomplete_expired"
      ) {
        return cancellationMessage;
      }
      if (
        current.customer_id !== subscription.customerId ||
        current.metadata.quieterUserId !== userId
      ) {
        throw new Error(
          "The subscription billing owner could not be verified."
        );
      }
      const synchronized = await syncBillingSubscription(current);
      if (!synchronized.synced) {
        throw new Error("The canceled subscription could not be reconciled.");
      }
    }
    const externalCustomers = new Set([
      getBillingExternalIdentity("user", userId),
      ...usage.flatMap((event) =>
        event.externalCustomerId === null ? [] : [event.externalCustomerId]
      ),
    ]);
    const queries: Parameters<Polar["subscriptions"]["list"]>[0][] = [
      ...[...externalCustomers].map((externalCustomerId) => ({
        external_customer_id: externalCustomerId,
      })),
      ...[...customers].map((customerId) => ({ customer_id: customerId })),
    ];
    for (const query of queries) {
      let page = 1;
      while (true) {
        const remaining = (deadline - Date.now()) / 1000;
        if (remaining <= 0) {
          throw new Error("Account deletion billing confirmation timed out.");
        }
        const result = await polar.subscriptions.list(
          { ...query, limit: 100, page },
          { timeout: remaining }
        );
        if (
          result.items.some(
            (subscription) =>
              subscription.status !== "canceled" &&
              subscription.status !== "incomplete_expired"
          )
        ) {
          return cancellationMessage;
        }
        if (page >= result.pagination.max_page) {
          break;
        }
        page += 1;
      }
    }
    return null;
  } catch (error) {
    reportError(error, { operation: "billing:confirm-account-deletion" });
    return "We could not confirm that all subscriptions are canceled. Please try again later or contact support before deleting your account.";
  }
};

export const requestAccountDeletion = async (userId: string) => {
  const failure = await closeAccountForDeletion(userId);
  if (failure !== null) {
    return failure;
  }
  try {
    const checkout = await recoverBillingCheckout({ userId });
    if (checkout.status === "open" || checkout.status === "pending") {
      return "A checkout is still pending. Wait for it to finish or expire, then try deleting your account again.";
    }
  } catch (error) {
    reportError(error, {
      operation: "billing:confirm-checkout-before-deletion",
    });
    return "We could not confirm your pending checkout. Please try again before deleting your account.";
  }
  // Commit closing before network reads so new checkouts cannot race confirmation.
  return await confirmProviderAccountClosed(userId);
};

export const requestOrganizationDeletion = async (organizationId: string) => {
  const [initialTeam] = await db
    .select({ payerId: organization.billingOwnerUserId })
    .from(organization)
    .where(eq(organization.id, organizationId));
  if (initialTeam === undefined) {
    return null;
  }
  return await db.transaction(async (transaction) => {
    if (initialTeam.payerId !== null) {
      await transaction
        .select({ id: user.id })
        .from(user)
        .where(eq(user.id, initialTeam.payerId))
        .for("update");
    }
    const [team] = await transaction
      .select()
      .from(organization)
      .where(eq(organization.id, organizationId))
      .for("update");
    if (team === undefined) {
      return null;
    }
    if (team.billingOwnerUserId !== initialTeam.payerId) {
      return "Team billing changed. Please try deleting the team again.";
    }
    await transaction
      .update(organization)
      .set({
        billingDeletionRequestedAt:
          team.billingDeletionRequestedAt ?? new Date(),
      })
      .where(eq(organization.id, organizationId));
    return await getUnresolvedFinancialWork(transaction, { organizationId });
  });
};
