import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  billingCreditUsageEvent,
  gmailAutoLabelEvent,
  mailbox,
  mailboxAgentRevision,
  mailboxAgentRun,
  mailboxVerificationCode,
  mailImportanceAttempt,
  member,
  organization,
  organizationMailUsageEvent,
} from "@quieter/database/schema";
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  lt,
  notExists,
  sql,
} from "drizzle-orm";

import { getAiUsageCostMicroCents } from "./ai-pricing.ts";
import { BILLING_USAGE_KINDS, billingCreditUsageKind } from "./credits.ts";
import type { BillingUsageKind, getBillingCreditUsage } from "./credits.ts";

type RecordedUsage = Omit<
  Awaited<ReturnType<typeof getBillingCreditUsage>>,
  "creditAmountMicroCents"
>;

type UsageTarget = { organizationId: string } | { billingOwnerUserId: string };

export const getCalendarUsagePeriod = (now = new Date()) => ({
  end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
});

export const getRecordedUsageOverview = async (
  target: UsageTarget,
  period = getCalendarUsagePeriod(),
  client: Pick<typeof db, "select"> = db
): Promise<RecordedUsage> => {
  const teams = await client
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(
      "organizationId" in target
        ? eq(organization.id, target.organizationId)
        : and(
            eq(organization.billingOwnerUserId, target.billingOwnerUserId),
            sql`exists (select 1 from ${member} where ${member.organizationId} = ${organization.id} and ${member.userId} = ${target.billingOwnerUserId} and 'owner' = any(string_to_array(${member.role}, ',')))`
          )
    );
  const result: RecordedUsage = {
    billableCostMicroCents: 0,
    breakdown: [],
    chargeableCostMicroCents: 0,
    costMicroCents: 0,
    organizations: [],
  };
  if (teams.length === 0) {
    return result;
  }
  const organizationIds = teams.map((team) => team.id);
  const sourceOrganizationId = sql<string>`coalesce(${billingCreditUsageEvent.sourceOrganizationId}, ${billingCreditUsageEvent.organizationId})`;
  const historicalOrganizationId = sql<string>`coalesce((
    select ${aiCreditReservation.organizationId}
    from ${aiCreditReservation}
    where ${aiCreditReservation.groupId} = source.group_id
    order by ${aiCreditReservation.createdAt}, ${aiCreditReservation.id}
    limit 1
  ), source.organization_id)`;
  const [ledger, mailUsage, aiUsage, historicalAiUsage] = await Promise.all([
    client
      .select({
        billableCostMicroCents:
          sql`coalesce(sum(${billingCreditUsageEvent.billableCostMicroCents}), 0)`.mapWith(
            Number
          ),
        costMicroCents:
          sql`coalesce(sum(${billingCreditUsageEvent.costMicroCents}), 0)`.mapWith(
            Number
          ),
        kind: billingCreditUsageKind.as("usage_kind"),
        organizationId: sourceOrganizationId,
      })
      .from(billingCreditUsageEvent)
      .where(
        and(
          inArray(sourceOrganizationId, organizationIds),
          "billingOwnerUserId" in target
            ? sql`(${billingCreditUsageEvent.userId} = ${target.billingOwnerUserId} or (${billingCreditUsageEvent.userId} is null and ${billingCreditUsageEvent.scope} = 'team'))`
            : undefined,
          gte(billingCreditUsageEvent.createdAt, period.start),
          lt(billingCreditUsageEvent.createdAt, period.end)
        )
      )
      .groupBy((selection) => [selection.organizationId, selection.kind]),
    client
      .select({
        costMicroCents:
          sql`sum(${organizationMailUsageEvent.includedSesCostMicroCents} + ${organizationMailUsageEvent.billableCostMicroCents})`.mapWith(
            Number
          ),
        direction: organizationMailUsageEvent.direction,
        organizationId: organizationMailUsageEvent.organizationId,
      })
      .from(organizationMailUsageEvent)
      .where(
        and(
          inArray(organizationMailUsageEvent.organizationId, organizationIds),
          gte(organizationMailUsageEvent.createdAt, period.start),
          lt(organizationMailUsageEvent.createdAt, period.end),
          notExists(
            client
              .select({ id: billingCreditUsageEvent.id })
              .from(billingCreditUsageEvent)
              .where(
                eq(
                  billingCreditUsageEvent.dedupeKey,
                  sql`'mail:' || ${organizationMailUsageEvent.dedupeKey}`
                )
              )
          )
        )
      )
      .groupBy(
        organizationMailUsageEvent.organizationId,
        organizationMailUsageEvent.direction
      ),
    client
      .select({
        costMicroCents:
          sql`coalesce(sum(${aiCreditReservation.actualCostMicroCents}), 0)`.mapWith(
            Number
          ),
        kind: aiCreditReservation.usageKind,
        organizationId: aiCreditReservation.organizationId,
      })
      .from(aiCreditReservation)
      .where(
        and(
          inArray(aiCreditReservation.organizationId, organizationIds),
          eq(aiCreditReservation.status, "settled"),
          isNotNull(aiCreditReservation.actualCostMicroCents),
          "billingOwnerUserId" in target
            ? sql`(${aiCreditReservation.billingUserId} is null or ${aiCreditReservation.billingUserId} = ${target.billingOwnerUserId})`
            : undefined,
          gte(aiCreditReservation.createdAt, period.start),
          lt(aiCreditReservation.createdAt, period.end),
          notExists(
            client
              .select({ id: billingCreditUsageEvent.id })
              .from(billingCreditUsageEvent)
              .where(
                eq(
                  billingCreditUsageEvent.dedupeKey,
                  sql`'ai:reservation:' || ${aiCreditReservation.id}`
                )
              )
          )
        )
      )
      .groupBy(
        aiCreditReservation.organizationId,
        aiCreditReservation.usageKind
      ),
    client
      .select({
        costUsd: sql<number>`sum(source.cost_usd)`.mapWith(Number),
        kind: sql<BillingUsageKind>`source.kind`,
        organizationId: historicalOrganizationId,
        recordedCostMicroCents: sql<number>`coalesce((
          select sum(${aiCreditReservation.actualCostMicroCents})
          from ${aiCreditReservation}
          where ${aiCreditReservation.groupId} = source.group_id
            and ${aiCreditReservation.status} = 'settled'
            and ${aiCreditReservation.account} is null
        ), 0)`.mapWith(Number),
      })
      .from(sql`(
        select ${gmailAutoLabelEvent.costUsd} as cost_usd, 'autoLabel' as kind,
          ${mailbox.organizationId} as organization_id, ${gmailAutoLabelEvent.createdAt} as created_at,
          ${gmailAutoLabelEvent.id} as external_id, ${gmailAutoLabelEvent.id} as group_id
        from ${gmailAutoLabelEvent} join ${mailbox} on ${mailbox.id} = ${gmailAutoLabelEvent.mailboxId}
        union all
        select ${mailboxVerificationCode.costUsd}, 'verificationCode', ${mailbox.organizationId}, ${mailboxVerificationCode.createdAt}, ${mailboxVerificationCode.id}, ${mailboxVerificationCode.id}
        from ${mailboxVerificationCode} join ${mailbox} on ${mailbox.id} = ${mailboxVerificationCode.mailboxId}
        union all
        select (${mailImportanceAttempt.usage}->>'costUsd')::double precision, 'importance', ${mailImportanceAttempt.organizationId}, ${mailImportanceAttempt.createdAt}, 'importance:' || ${mailImportanceAttempt.id}, 'importance:' || ${mailImportanceAttempt.id}
        from ${mailImportanceAttempt}
        union all
        select (${mailboxAgentRevision.usage}->>'costUsd')::double precision, 'mailAction', ${mailbox.organizationId}, ${mailboxAgentRevision.createdAt}, 'mail-action-review:' || ${mailboxAgentRevision.id}, 'mail-action-review:' || ${mailboxAgentRevision.id}
        from ${mailboxAgentRevision} join ${mailbox} on ${mailbox.id} = ${mailboxAgentRevision.mailboxId}
        union all
        select (step.value->>'costUsd')::double precision, 'mailAction', ${mailbox.organizationId}, ${mailboxAgentRun.createdAt}, 'mail-action:' || ${mailboxAgentRun.id} || ':' || (step.ordinality - 1), 'mail-action:' || ${mailboxAgentRun.id}
        from ${mailboxAgentRun} join ${mailbox} on ${mailbox.id} = ${mailboxAgentRun.mailboxId}
        cross join lateral jsonb_array_elements(coalesce(${mailboxAgentRun.usage}, '[]'::jsonb)) with ordinality as step(value, ordinality)
      ) as source`)
      .where(
        and(
          inArray(historicalOrganizationId, organizationIds),
          gte(sql`source.created_at`, period.start.toISOString()),
          lt(sql`source.created_at`, period.end.toISOString()),
          sql`source.cost_usd > 0`,
          sql`not exists (select 1 from ${billingCreditUsageEvent} where ${billingCreditUsageEvent.dedupeKey} = 'ai:' || source.external_id)`,
          sql`not exists (select 1 from ${aiCreditReservation} where ${aiCreditReservation.groupId} = source.group_id and ${aiCreditReservation.account} is not null)`
        )
      )
      .groupBy(
        historicalOrganizationId,
        sql`source.kind`,
        sql`source.group_id`
      ),
  ]);
  const entries = [
    ...ledger,
    ...mailUsage.map((item) => ({
      ...item,
      billableCostMicroCents: 0,
      kind: item.direction === "inbound" ? "inboundMail" : "outboundMail",
    })),
    ...aiUsage.map((item) => ({ ...item, billableCostMicroCents: 0 })),
    ...historicalAiUsage.map((item) => ({
      ...item,
      billableCostMicroCents: 0,
      costMicroCents: Math.max(
        0,
        getAiUsageCostMicroCents(item.costUsd) - item.recordedCostMicroCents
      ),
    })),
  ];
  const organizations = new Map<string, RecordedUsage["organizations"][number]>(
    teams.map((team) => [
      team.id,
      {
        billableCostMicroCents: 0,
        breakdown: [],
        costMicroCents: 0,
        organizationId: team.id,
        organizationName: team.name,
      },
    ])
  );
  for (const item of entries) {
    const entry = organizations.get(item.organizationId);
    if (entry === undefined) {
      continue;
    }
    const kind =
      BILLING_USAGE_KINDS.find((candidate) => candidate === item.kind) ??
      "other";
    entry.costMicroCents += item.costMicroCents;
    entry.billableCostMicroCents += item.billableCostMicroCents;
    result.costMicroCents += item.costMicroCents;
    result.billableCostMicroCents += item.billableCostMicroCents;
    for (const breakdown of [entry.breakdown, result.breakdown]) {
      const existing = breakdown.find((usage) => usage.kind === kind);
      if (existing === undefined) {
        breakdown.push({ costMicroCents: item.costMicroCents, kind });
      } else {
        existing.costMicroCents += item.costMicroCents;
      }
    }
  }
  result.organizations = [...organizations.values()];
  return result;
};
