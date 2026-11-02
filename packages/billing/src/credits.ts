import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  aiCreditReservation,
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
  min,
  notExists,
  or,
  sql,
  sum,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { BillingAccount } from "./entitlements.ts";
import {
  getBillingExternalIdentity,
  getPolarApiOrganizationId,
} from "./polar-config.ts";

const BILLING_CREDIT_USAGE_EVENT_NAME = "credit-usage";
const MICROCENTS_PER_CENT = 1_000_000;
const laterBillingSubscription = alias(
  billingSubscription,
  "laterBillingSubscription"
);

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
    billableCostCents: input.billableCostMicroCents / MICROCENTS_PER_CENT,
    category: input.category,
    creditUsageEventId: input.eventId,
    credits: input.costMicroCents / MICROCENTS_PER_CENT,
    totalCostCents: input.costMicroCents / MICROCENTS_PER_CENT,
    ...sanitizePolarEventMetadata(input.metadata),
  },
  name: BILLING_CREDIT_USAGE_EVENT_NAME,
  organizationId: getPolarApiOrganizationId(),
  timestamp: input.createdAt,
});

export const lockBillingAccount = async (
  account: Pick<
    BillingAccount,
    "organizationId" | "billingOwnerUserId" | "scope"
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
    .select({ billingOwnerUserId: organization.billingOwnerUserId })
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
};

export const getBillingUsagePeriodEnd = (
  account: BillingAccount,
  client: Pick<typeof db, "select"> = db
) => {
  if (
    account.currentPeriodEnd > new Date() ||
    account.providerSubscriptionId === undefined
  ) {
    return account.currentPeriodEnd;
  }

  // Continue counting the live period, but retain the original bound once a
  // later period exists because overwritten subscriptions lose period history.
  const laterPeriod = client
    .select({
      start: min(
        sql`least(${laterBillingSubscription.currentPeriodStart}, ${account.currentPeriodEnd.toISOString()}::timestamp)`
      ),
    })
    .from(laterBillingSubscription)
    .where(
      and(
        account.scope === "account" && account.billingOwnerUserId !== undefined
          ? and(
              eq(laterBillingSubscription.userId, account.billingOwnerUserId),
              or(
                eq(laterBillingSubscription.scope, "account"),
                eq(
                  laterBillingSubscription.providerSubscriptionId,
                  account.providerSubscriptionId
                )
              )
            )
          : and(
              eq(
                laterBillingSubscription.organizationId,
                account.organizationId
              ),
              eq(
                sql<string>`${laterBillingSubscription.metadata}->>'quieterOrganizationId'`,
                account.organizationId
              )
            ),
        inArray(laterBillingSubscription.plan, ["managed", "pro"]),
        inArray(laterBillingSubscription.status, [
          "active",
          "trialing",
          "past_due",
          "canceled",
        ]),
        gt(
          laterBillingSubscription.currentPeriodStart,
          account.currentPeriodStart
        )
      )
    );
  const currentPeriod = client
    .select({
      end: sql`least(case
      when ${gt(billingSubscription.currentPeriodStart, account.currentPeriodStart)}
        then least(${billingSubscription.currentPeriodStart}, ${account.currentPeriodEnd.toISOString()}::timestamp)
      when ${gt(billingSubscription.currentPeriodEnd, sql`now()`)}
        then ${billingSubscription.currentPeriodEnd}
      when ${and(eq(billingSubscription.status, "active"), eq(billingSubscription.cancelAtPeriodEnd, false))}
        then 'infinity'::timestamp
      else ${account.currentPeriodEnd.toISOString()}::timestamp
    end, coalesce((${laterPeriod}), 'infinity'::timestamp))`,
    })
    .from(billingSubscription)
    .where(
      and(
        eq(
          billingSubscription.providerSubscriptionId,
          account.providerSubscriptionId
        ),
        account.scope === "account" && account.billingOwnerUserId !== undefined
          ? eq(billingSubscription.userId, account.billingOwnerUserId)
          : and(
              eq(billingSubscription.organizationId, account.organizationId),
              eq(
                sql<string>`${billingSubscription.metadata}->>'quieterOrganizationId'`,
                account.organizationId
              )
            )
      )
    )
    .limit(1);
  return sql`coalesce((${currentPeriod}), ${account.currentPeriodEnd.toISOString()}::timestamp)`;
};

export const getBillingCreditUsage = async (
  account: BillingAccount,
  client: Pick<typeof db, "select"> = db
) => {
  if (account.scope === "account" && account.billingOwnerUserId === undefined) {
    throw new Error("The billing account payer is unavailable.");
  }
  const periodFilter = and(
    account.scope === "account" && account.billingOwnerUserId !== undefined
      ? eq(billingCreditUsageEvent.userId, account.billingOwnerUserId)
      : and(
          eq(billingCreditUsageEvent.organizationId, account.organizationId),
          eq(billingCreditUsageEvent.scope, "team")
        ),
    gte(billingCreditUsageEvent.createdAt, account.currentPeriodStart),
    lt(
      billingCreditUsageEvent.createdAt,
      getBillingUsagePeriodEnd(account, client)
    )
  );
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
        organizationId: billingCreditUsageEvent.organizationId,
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
    costMicroCents: usage?.costMicroCents ?? 0,
    creditAmountMicroCents: account.creditAmountCents * MICROCENTS_PER_CENT,
    organizations: [...organizations.values()],
  };
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
    await lockBillingAccount(account, transaction);
    if (input.aiReservationId !== undefined) {
      const [reservation] = await transaction
        .select({
          account: aiCreditReservation.account,
          billingUserId: aiCreditReservation.billingUserId,
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
      await transaction
        .update(aiCreditReservation)
        .set({ status: "settled" })
        .where(eq(aiCreditReservation.id, input.aiReservationId));
    }
    const [existingEvent] = await transaction
      .select({
        billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents,
        category: billingCreditUsageEvent.category,
        costMicroCents: billingCreditUsageEvent.costMicroCents,
        createdAt: billingCreditUsageEvent.createdAt,
        externalCustomerId: billingCreditUsageEvent.externalCustomerId,
        id: billingCreditUsageEvent.id,
        metadata: billingCreditUsageEvent.metadata,
        organizationId: billingCreditUsageEvent.organizationId,
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
        costMicroCents: existingEvent.costMicroCents,
        createdAt: existingEvent.createdAt,
        eventId: existingEvent.id,
        externalCustomerId,
        metadata: existingEvent.metadata ?? {},
        polarEventReportedAt: existingEvent.polarEventReportedAt,
      };
    }

    const usage = await getBillingCreditUsage(account, transaction);
    const billableBefore = Math.max(
      0,
      usage.costMicroCents - usage.creditAmountMicroCents
    );
    const billableAfter = Math.max(
      0,
      usage.costMicroCents + input.costMicroCents - usage.creditAmountMicroCents
    );
    const billableCostMicroCents = billableAfter - billableBefore;
    const createdAt = input.createdAt ?? new Date();
    const [event] = await transaction
      .insert(billingCreditUsageEvent)
      .values({
        billableCostMicroCents,
        category: input.category,
        costMicroCents: input.costMicroCents,
        createdAt,
        dedupeKey: input.dedupeKey,
        externalCustomerId: input.account.externalCustomerId,
        id: crypto.randomUUID(),
        metadata: input.metadata ?? {},
        organizationId: input.account.organizationId,
        scope: account.scope ?? "team",
        userId: account.billingOwnerUserId ?? null,
      })
      .onConflictDoNothing({ target: billingCreditUsageEvent.dedupeKey })
      .returning({
        id: billingCreditUsageEvent.id,
      });

    return {
      billableCostMicroCents: event === undefined ? 0 : billableCostMicroCents,
      category: input.category,
      costMicroCents: input.costMicroCents,
      createdAt,
      eventId: event?.id ?? null,
      externalCustomerId: input.account.externalCustomerId,
      metadata: input.metadata ?? {},
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

  if (
    (result.eventId ?? "") !== "" &&
    result.costMicroCents > 0 &&
    result.polarEventReportedAt === null
  ) {
    const polarEventReportedAt = new Date();

    try {
      const { ingestPolarEvents } = await import("./polar.ts");
      await ingestPolarEvents([
        createPolarCreditUsageEvent({
          account: { externalCustomerId: result.externalCustomerId },
          billableCostMicroCents: result.billableCostMicroCents,
          category: result.category,
          costMicroCents: result.costMicroCents,
          createdAt: result.createdAt,
          eventId: result.eventId,
          metadata: result.metadata,
        }),
      ]);
    } catch (error) {
      reportError(error, { operation: "billing:polar-usage-sync" });
      return result;
    }

    await db
      .update(billingCreditUsageEvent)
      .set({ polarEventReportedAt })
      .where(eq(billingCreditUsageEvent.id, result.eventId));

    return {
      ...result,
      polarEventReportedAt,
    };
  }

  return result;
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

const unreportedPositiveCreditUsageFilter = and(
  isNull(billingCreditUsageEvent.polarEventReportedAt),
  gt(billingCreditUsageEvent.costMicroCents, 0)
);

export const syncUnreportedBillingCreditUsage = async (
  input: { limit?: number } = {}
) => {
  const limit = input.limit ?? 100;
  const rows = await db
    .selectDistinct({
      billableCostMicroCents: billingCreditUsageEvent.billableCostMicroCents,
      category: billingCreditUsageEvent.category,
      costMicroCents: billingCreditUsageEvent.costMicroCents,
      createdAt: billingCreditUsageEvent.createdAt,
      eventId: billingCreditUsageEvent.id,
      externalCustomerId: billingCreditUsageEvent.externalCustomerId,
      metadata: billingCreditUsageEvent.metadata,
      organizationId: billingCreditUsageEvent.organizationId,
    })
    .from(billingCreditUsageEvent)
    .innerJoin(
      billingSubscription,
      currentActiveSubscriptionUnreportedUsageFilter
    )
    .where(
      and(
        unreportedPositiveCreditUsageFilter,
        or(
          gt(billingSubscription.currentPeriodEnd, new Date()),
          and(
            eq(billingSubscription.status, "active"),
            eq(billingSubscription.cancelAtPeriodEnd, false),
            notExists(
              db
                .select({ start: laterBillingSubscription.currentPeriodStart })
                .from(laterBillingSubscription)
                .where(
                  and(
                    or(
                      and(
                        isNotNull(billingCreditUsageEvent.externalCustomerId),
                        eq(
                          laterBillingSubscription.userId,
                          billingSubscription.userId
                        )
                      ),
                      and(
                        isNull(billingCreditUsageEvent.externalCustomerId),
                        eq(
                          laterBillingSubscription.organizationId,
                          billingSubscription.organizationId
                        ),
                        eq(
                          sql<string>`${laterBillingSubscription.metadata}->>'quieterOrganizationId'`,
                          billingSubscription.organizationId
                        )
                      )
                    ),
                    inArray(laterBillingSubscription.plan, ["managed", "pro"]),
                    inArray(laterBillingSubscription.status, [
                      "active",
                      "trialing",
                      "past_due",
                      "canceled",
                    ]),
                    gt(
                      laterBillingSubscription.currentPeriodStart,
                      billingSubscription.currentPeriodStart
                    )
                  )
                )
            )
          )
        )
      )
    )
    .orderBy(asc(billingCreditUsageEvent.createdAt))
    .limit(limit);

  if (rows.length === 0) {
    return {
      remaining: false,
      synced: 0,
    };
  }

  const polarEventReportedAt = new Date();
  const { ingestPolarEvents } = await import("./polar.ts");

  await ingestPolarEvents(
    rows.map((row) => {
      const externalCustomerId =
        row.externalCustomerId ??
        (row.organizationId === null
          ? null
          : getBillingExternalIdentity("organization", row.organizationId));
      if (externalCustomerId === null) {
        throw new Error("The usage reporting destination is unavailable.");
      }
      return createPolarCreditUsageEvent({
        account: { externalCustomerId },
        billableCostMicroCents: row.billableCostMicroCents,
        category: row.category,
        costMicroCents: row.costMicroCents,
        createdAt: row.createdAt,
        eventId: row.eventId,
        metadata: row.metadata ?? {},
      });
    })
  );

  await db
    .update(billingCreditUsageEvent)
    .set({ polarEventReportedAt })
    .where(
      and(
        inArray(
          billingCreditUsageEvent.id,
          rows.map((row) => row.eventId)
        ),
        isNull(billingCreditUsageEvent.polarEventReportedAt)
      )
    );

  return {
    remaining: rows.length === limit,
    synced: rows.length,
  };
};
