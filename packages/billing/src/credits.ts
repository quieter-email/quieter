import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingAccountSettings,
  member,
  billingCreditUsageEvent,
  billingSubscription,
  organization,
  user,
} from "@quieter/database/schema";
import type { BillingUsageCategory } from "@quieter/database/schema";
import { reportError } from "@quieter/observability";
import {
  and,
  asc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  isNotNull,
  lt,
  lte,
  or,
  sql,
  sum,
} from "drizzle-orm";

import {
  assertBillingMoney,
  calculateBillingLiability,
  getBillingBudget,
  getBillingLedgerPeriodFilter,
} from "./budget.ts";
import type { BillingAccount } from "./entitlements.ts";
import {
  getBillingExternalIdentity,
  getPolarApiOrganizationId,
} from "./polar-config.ts";

const BILLING_CREDIT_USAGE_EVENT_NAME = "credit-usage";
const MICROCENTS_PER_CENT = 1_000_000;

export const BILLING_USAGE_KINDS = [
  "aiChat",
  "aiMemory",
  "mailAction",
  "autoLabel",
  "importance",
  "usefulDetails",
  "verificationCode",
  "inboundMail",
  "outboundMail",
  "other",
] as const;

export type BillingUsageKind = (typeof BILLING_USAGE_KINDS)[number];

const sanitizePolarEventMetadata = (
  metadata: Record<string, string | number | boolean>
) =>
  Object.fromEntries(
    Object.entries(metadata).filter(
      ([key, value]) => value !== "" && !key.startsWith("recovery")
    )
  );

export const createPolarCreditUsageEvent = (input: {
  account: Pick<BillingAccount, "externalCustomerId">;
  billableCostMicroCents: number;
  category: BillingUsageCategory;
  costMicroCents: number;
  createdAt: Date;
  eventId: string;
  metadata: Record<string, string | number | boolean>;
}) => ({
  externalCustomerId: input.account.externalCustomerId,
  externalId: `credit-usage:${input.eventId}`,
  metadata: {
    ...sanitizePolarEventMetadata(input.metadata),
    billableCostCents: input.billableCostMicroCents / MICROCENTS_PER_CENT,
    category: input.category,
    creditUsageEventId: input.eventId,
    credits: input.costMicroCents / MICROCENTS_PER_CENT,
    totalCostCents: input.costMicroCents / MICROCENTS_PER_CENT,
  },
  name: BILLING_CREDIT_USAGE_EVENT_NAME,
  organizationId: getPolarApiOrganizationId(),
  timestamp: input.createdAt,
});

export const lockBillingAccount = async (
  account: Pick<
    BillingAccount,
    "organizationId" | "billingOwnerUserId" | "scope"
  > &
    Partial<
      Pick<
        BillingAccount,
        "providerSubscriptionId" | "currentPeriodStart" | "currentPeriodEnd"
      >
    >,
  transaction: DatabaseTransaction,
  options: { admission?: boolean } = {}
) => {
  if (account.scope === "account" && account.billingOwnerUserId === undefined) {
    throw new Error("The billing account payer is unavailable.");
  }
  if (account.billingOwnerUserId !== undefined) {
    const [payer] = await transaction
      .select({ id: user.id })
      .from(user)
      .where(eq(user.id, account.billingOwnerUserId))
      .for("update");
    if (payer === undefined) {
      throw new Error("The billing account payer is unavailable.");
    }
  }
  const [team] = await transaction
    .select({
      billingOwnerUserId: organization.billingOwnerUserId,
      closingAt: organization.billingDeletionRequestedAt,
    })
    .from(organization)
    .where(eq(organization.id, account.organizationId))
    .for("update");
  if (
    options.admission === true &&
    (team === undefined ||
      (account.billingOwnerUserId !== undefined &&
        team.billingOwnerUserId !== account.billingOwnerUserId))
  ) {
    throw new Error("The team's billing account changed. Please try again.");
  }
  if (options.admission === true) {
    if (team?.closingAt !== null && team?.closingAt !== undefined) {
      throw new Error("This team is closing and cannot start new usage.");
    }
    if (
      account.scope === "account" &&
      account.billingOwnerUserId !== undefined
    ) {
      const [settings] = await transaction
        .select({ closingAt: billingAccountSettings.deletionRequestedAt })
        .from(billingAccountSettings)
        .where(eq(billingAccountSettings.userId, account.billingOwnerUserId))
        .limit(1);
      const [owner] = await transaction
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, account.organizationId),
            eq(member.userId, account.billingOwnerUserId),
            sql`'owner' = any(string_to_array(${member.role}, ','))`
          )
        )
        .limit(1);
      const [subscription] =
        account.providerSubscriptionId === undefined
          ? []
          : await transaction
              .select()
              .from(billingSubscription)
              .where(
                and(
                  eq(
                    billingSubscription.providerSubscriptionId,
                    account.providerSubscriptionId
                  ),
                  eq(billingSubscription.userId, account.billingOwnerUserId),
                  eq(billingSubscription.scope, "account")
                )
              )
              .limit(1);
      const now = new Date();
      if (
        subscription === undefined ||
        account.currentPeriodStart === undefined ||
        account.currentPeriodEnd === undefined ||
        account.currentPeriodStart > now ||
        account.currentPeriodEnd <= now ||
        subscription.currentPeriodStart.getTime() !==
          account.currentPeriodStart.getTime() ||
        subscription.currentPeriodEnd.getTime() !==
          account.currentPeriodEnd.getTime() ||
        (subscription.status !== "active" && subscription.status !== "trialing")
      ) {
        throw new Error(
          "The billing period is not confirmed. Please try again."
        );
      }
      if (
        owner === undefined ||
        (settings?.closingAt !== null && settings?.closingAt !== undefined)
      ) {
        throw new Error("The team's billing account is unavailable.");
      }
    }
  }
  return team;
};

export const getBillingCreditUsage = async (
  account: BillingAccount,
  client: Pick<typeof db, "select"> = db
) => {
  if (account.scope === "account" && account.billingOwnerUserId === undefined) {
    throw new Error("The billing account payer is unavailable.");
  }
  const periodFilter = getBillingLedgerPeriodFilter(account);
  const usageKind = sql<BillingUsageKind>`case
    when ${and(eq(billingCreditUsageEvent.category, "mail"), eq(sql`${billingCreditUsageEvent.metadata}->>'direction'`, "inbound"))} then 'inboundMail'
    when ${and(eq(billingCreditUsageEvent.category, "mail"), eq(sql`${billingCreditUsageEvent.metadata}->>'direction'`, "outbound"))} then 'outboundMail'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "importance"))} then 'importance'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "autoLabel"))} then 'autoLabel'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "aiMemory"))} then 'aiMemory'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "mailAction"))} then 'mailAction'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "usefulDetails"))} then 'usefulDetails'
    when ${and(eq(billingCreditUsageEvent.category, "ai"), eq(sql`${billingCreditUsageEvent.metadata}->>'usageKind'`, "verificationCode"))} then 'verificationCode'
    when ${eq(billingCreditUsageEvent.category, "ai")} then 'aiChat'
    else 'other'
  end`;
  const [[usage], breakdown, organizationBreakdown] = await Promise.all([
    client
      .select({
        billableCostMicroCents:
          sql`coalesce(${sum(billingCreditUsageEvent.billableCostMicroCents)}, 0)`.mapWith(
            Number
          ),
        chargeableCostMicroCents:
          sql`coalesce(sum(coalesce(${billingCreditUsageEvent.chargeableCostMicroCents}, ${billingCreditUsageEvent.costMicroCents})), 0)`.mapWith(
            Number
          ),
        costMicroCents:
          sql`coalesce(${sum(billingCreditUsageEvent.costMicroCents)}, 0)`.mapWith(
            Number
          ),
      })
      .from(billingCreditUsageEvent)
      .where(periodFilter)
      .limit(1),
    client
      .select({
        costMicroCents:
          sql`coalesce(${sum(billingCreditUsageEvent.costMicroCents)}, 0)`.mapWith(
            Number
          ),
        kind: usageKind.as("usage_kind"),
      })
      .from(billingCreditUsageEvent)
      .where(periodFilter)
      .groupBy((selection) => selection.kind),
    client
      .select({
        billableCostMicroCents:
          sql`coalesce(${sum(billingCreditUsageEvent.billableCostMicroCents)}, 0)`.mapWith(
            Number
          ),
        costMicroCents:
          sql`coalesce(${sum(billingCreditUsageEvent.costMicroCents)}, 0)`.mapWith(
            Number
          ),
        kind: usageKind.as("usage_kind"),
        organizationId: sql<
          string | null
        >`coalesce(${billingCreditUsageEvent.sourceOrganizationId}, ${billingCreditUsageEvent.organizationId})`,
        organizationName: organization.name,
      })
      .from(billingCreditUsageEvent)
      .leftJoin(
        organization,
        eq(organization.id, billingCreditUsageEvent.organizationId)
      )
      .where(periodFilter)
      .groupBy((selection) => [
        selection.organizationId,
        selection.organizationName,
        selection.kind,
      ]),
  ]);
  const organizations = new Map<
    string | null,
    {
      organizationId: string | null;
      organizationName: string;
      billableCostMicroCents: number;
      costMicroCents: number;
      breakdown: { kind: BillingUsageKind; costMicroCents: number }[];
    }
  >();
  for (const item of organizationBreakdown) {
    const entry = organizations.get(item.organizationId) ?? {
      billableCostMicroCents: 0,
      breakdown: [],
      costMicroCents: 0,
      organizationId: item.organizationId,
      organizationName: item.organizationName ?? "Deleted team",
    };
    entry.costMicroCents += item.costMicroCents;
    entry.billableCostMicroCents += item.billableCostMicroCents;
    entry.breakdown.push({
      costMicroCents: item.costMicroCents,
      kind: item.kind,
    });
    organizations.set(item.organizationId, entry);
  }

  return {
    billableCostMicroCents: usage?.billableCostMicroCents ?? 0,
    breakdown: breakdown.map((item) => ({
      costMicroCents: item.costMicroCents ?? 0,
      kind: item.kind,
    })),
    chargeableCostMicroCents: usage?.chargeableCostMicroCents ?? 0,
    costMicroCents: usage?.costMicroCents ?? 0,
    creditAmountMicroCents: account.creditAmountCents * MICROCENTS_PER_CENT,
    organizations: [...organizations.values()],
  };
};

const currentActiveSubscriptionUnreportedUsageFilter = and(
  or(
    and(
      isNotNull(billingCreditUsageEvent.externalCustomerId),
      or(
        eq(billingCreditUsageEvent.userId, billingSubscription.userId),
        and(
          isNull(billingCreditUsageEvent.userId),
          eq(billingCreditUsageEvent.scope, "team"),
          eq(
            billingCreditUsageEvent.organizationId,
            billingSubscription.organizationId
          )
        )
      ),
      eq(
        billingCreditUsageEvent.externalCustomerId,
        sql`case when ${billingSubscription.scope} = 'account'
          then ${getBillingExternalIdentity("user", "")} || ${billingSubscription.userId}
          else ${getBillingExternalIdentity("organization", "")} || coalesce(${billingSubscription.organizationId}, ${billingSubscription.metadata}->>'quieterOrganizationId') end`
      )
    ),
    and(
      isNull(billingCreditUsageEvent.externalCustomerId),
      eq(billingCreditUsageEvent.scope, "team"),
      or(
        isNull(billingCreditUsageEvent.userId),
        eq(billingCreditUsageEvent.userId, billingSubscription.userId)
      ),
      eq(
        billingSubscription.organizationId,
        billingCreditUsageEvent.organizationId
      )
    )
  ),
  inArray(billingSubscription.plan, ["managed", "pro"]),
  inArray(billingSubscription.status, ["active", "trialing"]),
  gte(
    billingCreditUsageEvent.createdAt,
    billingSubscription.currentPeriodStart
  ),
  or(
    lt(billingCreditUsageEvent.createdAt, billingSubscription.currentPeriodEnd),
    and(
      eq(billingSubscription.status, "active"),
      eq(billingSubscription.cancelAtPeriodEnd, false),
      lte(billingSubscription.currentPeriodEnd, sql`now()`)
    )
  )
);

export const createPolarAccountUsageEvent = (input: {
  externalCustomerId: string;
  eventId: string;
  createdAt: Date;
  billableCostMicroCents: number;
}) => {
  assertBillingMoney(input.billableCostMicroCents);
  return {
    externalCustomerId: input.externalCustomerId,
    externalId: `account-usage:${input.eventId}`,
    metadata: {
      billableMicroCents: input.billableCostMicroCents,
      creditUsageEventId: input.eventId,
    },
    name: "account-usage",
    organizationId: getPolarApiOrganizationId(),
    timestamp: input.createdAt,
  };
};

export const reportBillingCreditUsageEvent = async (eventId: string) => {
  const [row] = await db
    .select()
    .from(billingCreditUsageEvent)
    .where(eq(billingCreditUsageEvent.id, eventId))
    .limit(1);
  if (row === undefined) {
    throw new Error("The billing usage event is unavailable.");
  }
  if (row.polarEventReportedAt !== null) {
    return {
      polarEventDeferredReason: row.polarEventDeferredReason,
      polarEventReportedAt: row.polarEventReportedAt,
    };
  }
  const now = new Date();
  if (
    row.liabilityWrittenOffAt !== null ||
    (row.scope === "account" && row.billableCostMicroCents === 0)
  ) {
    return { polarEventDeferredReason: null, polarEventReportedAt: null };
  }
  if (row.scope === "account") {
    const [subscription] =
      row.providerSubscriptionId === null
        ? []
        : await db
            .select()
            .from(billingSubscription)
            .where(
              and(
                eq(
                  billingSubscription.providerSubscriptionId,
                  row.providerSubscriptionId
                ),
                row.userId === null
                  ? sql`false`
                  : eq(billingSubscription.userId, row.userId),
                eq(billingSubscription.scope, "account")
              )
            )
            .limit(1);
    const closed =
      (subscription !== undefined &&
        row.billingPeriodStart !== null &&
        subscription.currentPeriodStart.getTime() !==
          row.billingPeriodStart.getTime()) ||
      (subscription?.currentPeriodEnd ?? row.billingPeriodEnd ?? now) <= now;
    const confirmed =
      subscription !== undefined &&
      row.billingPeriodStart !== null &&
      row.billingPeriodEnd !== null &&
      subscription.currentPeriodStart.getTime() ===
        row.billingPeriodStart.getTime() &&
      subscription.currentPeriodStart <= now &&
      subscription.currentPeriodEnd > now &&
      row.createdAt >= row.billingPeriodStart &&
      row.createdAt < subscription.currentPeriodEnd &&
      (subscription.status === "active" || subscription.status === "trialing");
    if (closed || !confirmed) {
      const reason = closed ? "closed_period" : "unconfirmed_period";
      await db
        .update(billingCreditUsageEvent)
        .set({ polarEventDeferredAt: now, polarEventDeferredReason: reason })
        .where(eq(billingCreditUsageEvent.id, row.id));
      return { polarEventDeferredReason: reason, polarEventReportedAt: null };
    }
  } else {
    const [eligible] = await db
      .select({ id: billingCreditUsageEvent.id })
      .from(billingCreditUsageEvent)
      .innerJoin(
        billingSubscription,
        currentActiveSubscriptionUnreportedUsageFilter
      )
      .where(
        and(
          eq(billingCreditUsageEvent.id, row.id),
          gt(billingSubscription.currentPeriodEnd, now)
        )
      )
      .limit(1);
    if (eligible === undefined) {
      await db
        .update(billingCreditUsageEvent)
        .set({
          polarEventDeferredAt: now,
          polarEventDeferredReason: "closed_period",
        })
        .where(eq(billingCreditUsageEvent.id, row.id));
      return {
        polarEventDeferredReason: "closed_period",
        polarEventReportedAt: null,
      };
    }
  }
  const externalCustomerId =
    row.externalCustomerId ??
    (row.scope === "team" && row.organizationId !== null
      ? getBillingExternalIdentity("organization", row.organizationId)
      : null);
  if (externalCustomerId === null) {
    throw new Error("The usage reporting destination is unavailable.");
  }
  const [attempt] = await db
    .update(billingCreditUsageEvent)
    .set({
      polarEventAttemptedAt: sql`coalesce(${billingCreditUsageEvent.polarEventAttemptedAt}, now())`,
    })
    .where(
      and(
        eq(billingCreditUsageEvent.id, row.id),
        eq(
          billingCreditUsageEvent.billableCostMicroCents,
          row.billableCostMicroCents
        ),
        isNull(billingCreditUsageEvent.polarEventReportedAt),
        isNull(billingCreditUsageEvent.liabilityWrittenOffAt)
      )
    )
    .returning({ id: billingCreditUsageEvent.id });
  if (attempt === undefined) {
    return { polarEventDeferredReason: null, polarEventReportedAt: null };
  }
  const { ingestPolarEvents } = await import("./polar.ts");
  await ingestPolarEvents([
    row.scope === "account"
      ? createPolarAccountUsageEvent({
          billableCostMicroCents: row.billableCostMicroCents,
          createdAt: row.createdAt,
          eventId: row.id,
          externalCustomerId,
        })
      : createPolarCreditUsageEvent({
          account: { externalCustomerId },
          billableCostMicroCents: row.billableCostMicroCents,
          category: row.category,
          costMicroCents: row.costMicroCents,
          createdAt: row.createdAt,
          eventId: row.id,
          metadata: row.metadata ?? {},
        }),
  ]);
  await db
    .update(billingCreditUsageEvent)
    .set({
      polarEventDeferredAt: null,
      polarEventDeferredReason: null,
      polarEventReportedAt: now,
    })
    .where(eq(billingCreditUsageEvent.id, row.id));
  return { polarEventDeferredReason: null, polarEventReportedAt: now };
};

export const recordBillingCreditUsage = async (
  input: {
    account: BillingAccount;
    aiReservationId?: string;
    category: BillingUsageCategory;
    costMicroCents: number;
    createdAt?: Date;
    dedupeKey: string;
    metadata?: Record<string, string | number | boolean>;
  },
  outerTransaction?: DatabaseTransaction
) => {
  assertBillingMoney(input.costMicroCents);
  const persist = async (transaction: DatabaseTransaction) => {
    let { account } = input;
    if (
      input.aiReservationId !== undefined &&
      account.billingOwnerUserId === undefined
    ) {
      const [identity] = await transaction
        .select({ billingUserId: aiCreditReservation.billingUserId })
        .from(aiCreditReservation)
        .where(
          and(
            eq(aiCreditReservation.id, input.aiReservationId),
            eq(aiCreditReservation.organizationId, account.organizationId)
          )
        )
        .limit(1);
      account = {
        ...account,
        billingOwnerUserId: identity?.billingUserId ?? undefined,
      };
    }
    const funding = await lockBillingAccount(account, transaction);
    if (input.aiReservationId !== undefined) {
      const [reservation] = await transaction
        .select({
          account: aiCreditReservation.account,
          billingUserId: aiCreditReservation.billingUserId,
          reservedCostMicroCents: aiCreditReservation.reservedCostMicroCents,
          status: aiCreditReservation.status,
        })
        .from(aiCreditReservation)
        .where(
          and(
            eq(aiCreditReservation.id, input.aiReservationId),
            eq(aiCreditReservation.organizationId, input.account.organizationId)
          )
        )
        .for("update");
      if (
        reservation === undefined ||
        reservation.status === "released" ||
        (reservation.account?.billingOwnerUserId ??
          reservation.billingUserId ??
          undefined) !== account.billingOwnerUserId
      ) {
        throw new Error("The AI billing reservation is unavailable.");
      }
      if (reservation.account !== null) {
        account = {
          ...reservation.account,
          authorizedCostMicroCents:
            reservation.account.authorizedCostMicroCents === undefined
              ? reservation.reservedCostMicroCents
              : reservation.account.authorizedCostMicroCents,
          currentPeriodEnd: new Date(reservation.account.currentPeriodEnd),
          currentPeriodStart: new Date(reservation.account.currentPeriodStart),
        };
      }
      await transaction
        .update(aiCreditReservation)
        .set({ status: "settled" })
        .where(eq(aiCreditReservation.id, input.aiReservationId));
    }
    const [existingEvent] = await transaction
      .select({
        billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents,
        category: billingCreditUsageEvent.category,
        chargeableCostMicroCents:
          billingCreditUsageEvent.chargeableCostMicroCents,
        costMicroCents: billingCreditUsageEvent.costMicroCents,
        createdAt: billingCreditUsageEvent.createdAt,
        externalCustomerId: billingCreditUsageEvent.externalCustomerId,
        id: billingCreditUsageEvent.id,
        metadata: billingCreditUsageEvent.metadata,
        organizationId: billingCreditUsageEvent.organizationId,
        polarEventDeferredReason:
          billingCreditUsageEvent.polarEventDeferredReason,
        polarEventReportedAt: billingCreditUsageEvent.polarEventReportedAt,
      })
      .from(billingCreditUsageEvent)
      .where(eq(billingCreditUsageEvent.dedupeKey, input.dedupeKey))
      .limit(1);

    if (existingEvent !== undefined) {
      const externalCustomerId =
        existingEvent.externalCustomerId ??
        (existingEvent.organizationId === null
          ? null
          : getBillingExternalIdentity(
              "organization",
              existingEvent.organizationId
            ));
      if (externalCustomerId === null) {
        throw new Error("The usage reporting destination is unavailable.");
      }
      return {
        billableCostMicroCents: existingEvent.billableCostMicroCents,
        category: existingEvent.category,
        chargeableCostMicroCents:
          existingEvent.chargeableCostMicroCents ??
          existingEvent.costMicroCents,
        costMicroCents: existingEvent.costMicroCents,
        createdAt: existingEvent.createdAt,
        eventId: existingEvent.id,
        externalCustomerId,
        metadata: existingEvent.metadata ?? {},
        polarEventDeferredReason: existingEvent.polarEventDeferredReason,
        polarEventReportedAt: existingEvent.polarEventReportedAt,
      };
    }

    const budget = await getBillingBudget(account, transaction, {
      usageDedupeKey: input.dedupeKey,
    });
    let defaultAuthorization =
      input.category === "ai" ? 0 : input.costMicroCents;
    if (
      account.scope === "account" &&
      account.authorizedCostMicroCents === undefined &&
      input.aiReservationId === undefined
    ) {
      const [owner] = await transaction
        .select({ id: member.id })
        .from(member)
        .where(
          and(
            eq(member.organizationId, account.organizationId),
            account.billingOwnerUserId === undefined
              ? sql`false`
              : eq(member.userId, account.billingOwnerUserId),
            sql`'owner' = any(string_to_array(${member.role}, ','))`
          )
        )
        .limit(1);
      const [settings] =
        account.billingOwnerUserId === undefined
          ? []
          : await transaction
              .select({ closingAt: billingAccountSettings.deletionRequestedAt })
              .from(billingAccountSettings)
              .where(
                eq(billingAccountSettings.userId, account.billingOwnerUserId)
              )
              .limit(1);
      if (
        owner === undefined ||
        funding?.billingOwnerUserId !== account.billingOwnerUserId ||
        funding?.closingAt !== null ||
        (settings?.closingAt !== null && settings?.closingAt !== undefined)
      ) {
        defaultAuthorization = 0;
      }
    }
    const { billableCostMicroCents, chargeableCostMicroCents } =
      calculateBillingLiability({
        ...budget,
        authorizedCostMicroCents:
          account.authorizedCostMicroCents === undefined
            ? defaultAuthorization
            : account.authorizedCostMicroCents,
        costMicroCents: input.costMicroCents,
        includedRemainingMicroCents: budget.settledIncludedRemainingMicroCents,
      });
    const createdAt = input.createdAt ?? new Date();
    const [event] = await transaction
      .insert(billingCreditUsageEvent)
      .values({
        billableCostMicroCents,
        billingPeriodEnd: account.currentPeriodEnd,
        billingPeriodStart: account.currentPeriodStart,
        category: input.category,
        chargeableCostMicroCents,
        costMicroCents: input.costMicroCents,
        createdAt,
        dedupeKey: input.dedupeKey,
        externalCustomerId: account.externalCustomerId,
        id: crypto.randomUUID(),
        metadata: input.metadata ?? {},
        organizationId: input.account.organizationId,
        providerSubscriptionId: account.providerSubscriptionId ?? null,
        scope: account.scope ?? "team",
        sourceOrganizationId: account.organizationId,
        userId: account.billingOwnerUserId ?? null,
      })
      .onConflictDoNothing({ target: billingCreditUsageEvent.dedupeKey })
      .returning({
        id: billingCreditUsageEvent.id,
      });

    return {
      billableCostMicroCents: event === undefined ? 0 : billableCostMicroCents,
      category: input.category,
      chargeableCostMicroCents,
      costMicroCents: input.costMicroCents,
      createdAt,
      eventId: event?.id ?? null,
      externalCustomerId: account.externalCustomerId,
      metadata: input.metadata ?? {},
      polarEventDeferredReason: null,
      polarEventReportedAt: null,
    };
  };
  const result =
    outerTransaction === undefined
      ? await db.transaction(persist)
      : await persist(outerTransaction);

  // Operational recovery defers reporting until its outer transaction commits.
  if (outerTransaction !== undefined) {
    return result;
  }

  if (result.eventId !== null && result.polarEventReportedAt === null) {
    try {
      const reporting = await reportBillingCreditUsageEvent(result.eventId);
      return { ...result, ...reporting };
    } catch (error) {
      reportError(error, { operation: "billing:polar-usage-sync" });
    }
  }
  return result;
};

export const syncUnreportedBillingCreditUsage = async (
  input: { limit?: number } = {}
) => {
  const limit = input.limit ?? 100;
  const rows = await db
    .select({ id: billingCreditUsageEvent.id })
    .from(billingCreditUsageEvent)
    .where(
      and(
        isNull(billingCreditUsageEvent.polarEventReportedAt),
        isNull(billingCreditUsageEvent.liabilityWrittenOffAt),
        or(
          eq(billingCreditUsageEvent.scope, "team"),
          gt(billingCreditUsageEvent.billableCostMicroCents, 0)
        ),
        or(
          isNull(billingCreditUsageEvent.polarEventDeferredAt),
          eq(
            billingCreditUsageEvent.polarEventDeferredReason,
            "unconfirmed_period"
          )
        )
      )
    )
    .orderBy(
      asc(
        sql`coalesce(${billingCreditUsageEvent.polarEventDeferredAt}, ${billingCreditUsageEvent.createdAt})`
      )
    )
    .limit(limit);
  let synced = 0;
  for (const row of rows) {
    const result = await reportBillingCreditUsageEvent(row.id);
    if (result.polarEventReportedAt !== null) {
      synced += 1;
    }
  }
  return { remaining: rows.length === limit, synced };
};
