import { serverEnv } from "@quieter/env/server";
import type postgres from "postgres";

type UsageTotals = {
  costMicroCents: string;
  recordedCostOperations: number;
  releasedReservations: number;
  uncostedReservationAttempts: number;
  unrecordedCostMicroCents: string;
  unrecordedCostReservations: number;
};

type BreakdownRow = UsageTotals & {
  attribution: "payer" | "current-funded-team";
  evidence: "legacy-ledger" | "reservation-ledger" | "reservation";
  operation: string;
};

type AiMemoryUsageReport = UsageTotals & {
  breakdown: BreakdownRow[];
  mode: "metered" | "unlimited" | "unavailable";
  period: { end: string; start: string } | null;
};

export const inspectAiMemoryUsage = async (
  transaction: postgres.TransactionSql,
  userId: string
) => {
  let report: AiMemoryUsageReport | undefined;
  try {
    await transaction`SET LOCAL statement_timeout = '10s'`;
    [report] = await transaction<AiMemoryUsageReport[]>`
        WITH target AS (
          SELECT id FROM "user" WHERE id = ${userId}
        ), account AS (
          SELECT target.id, EXISTS (
            SELECT 1 FROM "billingEntitlementOverride" grant_row
            WHERE grant_row."userId" = target.id AND grant_row."revokedAt" IS NULL
              AND (grant_row."expiresAt" IS NULL OR grant_row."expiresAt" > now() AT TIME ZONE 'UTC')
          ) AS unlimited
          FROM target
          LEFT JOIN "billingAccountSettings" settings ON settings."userId" = target.id
          WHERE settings."deletionRequestedAt" IS NULL
        ), period AS (
          SELECT account.id, account.unlimited, subscription."providerSubscriptionId" AS subscription_id,
            CASE WHEN account.unlimited THEN date_trunc('month', now() AT TIME ZONE 'UTC')
              ELSE subscription."currentPeriodStart" END AS period_start,
            CASE WHEN account.unlimited THEN date_trunc('month', now() AT TIME ZONE 'UTC') + interval '1 month'
              ELSE subscription."currentPeriodEnd" END AS period_end
          FROM account
          LEFT JOIN LATERAL (
            SELECT s."providerSubscriptionId", s."currentPeriodStart", s."currentPeriodEnd",
              s."lastReconciliationFailureAt"
            FROM "billingSubscription" s
            WHERE NOT account.unlimited AND s."userId" = account.id AND s.scope = 'account'
              AND s.plan IN ('managed', 'pro') AND s."organizationId" IS NULL
              AND s."providerCustomerId" IS NOT NULL
              AND s.metadata->>'quieterUserId' = account.id
              AND s.metadata->>'quieterScope' = 'account'
              AND s.metadata->>'quieterProduct' = s.plan
              AND s."providerProductId" = CASE WHEN s.plan = 'managed'
                THEN ${serverEnv.POLAR_PRODUCT_MANAGED_ID ?? null}::text
                ELSE ${serverEnv.POLAR_PRODUCT_PRO_ID ?? null}::text END
              AND s.status IN ('active', 'trialing') AND s."currentPeriodEnd" > now() AT TIME ZONE 'UTC'
            ORDER BY s."updatedAt" DESC, s.id LIMIT 1
          ) subscription ON true
          WHERE account.unlimited OR (
            subscription."providerSubscriptionId" IS NOT NULL
            AND subscription."lastReconciliationFailureAt" IS NULL
          )
        ), funded_teams AS (
          SELECT o.id FROM period p
          JOIN organization o ON o."billingOwnerUserId" = p.id
          WHERE p.unlimited AND EXISTS (
            SELECT 1 FROM member m WHERE m."organizationId" = o.id AND m."userId" = p.id
              AND 'owner' = ANY(string_to_array(m.role, ','))
          )
        ), scoped_reservations AS (
          SELECT r.id, r."groupId", r.status, r."actualCostMicroCents", p.unlimited,
            coalesce(r.account->>'billingOwnerUserId', r."billingUserId") AS payer
          FROM period p JOIN "aiCreditReservation" r ON r."usageKind" = 'aiMemory'
          WHERE (
            NOT p.unlimited
            AND coalesce(r.account->>'billingOwnerUserId', r."billingUserId") = p.id
            AND r.account->>'scope' = 'account'
            AND r.account->>'providerSubscriptionId' = p.subscription_id
            AND r.account->>'currentPeriodStart' = to_char(p.period_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) OR (
            p.unlimited AND r."organizationId" IN (SELECT id FROM funded_teams)
            AND r."createdAt" >= p.period_start AND r."createdAt" < p.period_end
            AND (coalesce(r.account->>'billingOwnerUserId', r."billingUserId") = p.id
              OR (r.account->>'billingOwnerUserId' IS NULL AND r."billingUserId" IS NULL))
          )
        ), usage_rows AS (
          SELECT CASE WHEN starts_with(e."dedupeKey", 'ai:reservation:')
              THEN r."groupId" ELSE substr(e."dedupeKey", 4) END AS operation_key,
            CASE WHEN starts_with(e."dedupeKey", 'ai:reservation:')
              THEN 'reservation-ledger' ELSE 'legacy-ledger' END AS evidence,
            CASE WHEN e."userId" IS NULL THEN 'current-funded-team' ELSE 'payer' END AS attribution,
            e."costMicroCents" AS cost, NULL::bigint AS unrecorded_cost, NULL::text AS attempt_status
          FROM period p JOIN "billingCreditUsageEvent" e
            ON e.category = 'ai' AND e.metadata->>'usageKind' = 'aiMemory'
          LEFT JOIN "aiCreditReservation" r ON starts_with(e."dedupeKey", 'ai:reservation:')
            AND r.id = substr(e."dedupeKey", 16) AND r."usageKind" = 'aiMemory'
          WHERE (
            NOT p.unlimited AND e.scope = 'account' AND e."userId" = p.id
            AND e."billingPeriodStart" = p.period_start AND e."providerSubscriptionId" = p.subscription_id
          ) OR (
            p.unlimited AND coalesce(e."sourceOrganizationId", e."organizationId") IN (SELECT id FROM funded_teams)
            AND (e."userId" = p.id OR (e."userId" IS NULL AND e.scope = 'team'))
            AND e."createdAt" >= p.period_start AND e."createdAt" < p.period_end
          )
          UNION ALL
          SELECT r."groupId", 'reservation',
            CASE WHEN r.payer IS NULL THEN 'current-funded-team' ELSE 'payer' END,
            CASE WHEN r.unlimited AND r.status = 'settled' THEN r."actualCostMicroCents" END,
            CASE WHEN NOT (r.unlimited AND r.status = 'settled') THEN r."actualCostMicroCents" END,
            r.status
          FROM scoped_reservations r
          WHERE NOT EXISTS (
            SELECT 1 FROM "billingCreditUsageEvent" e WHERE e."dedupeKey" = 'ai:reservation:' || r.id
          )
        ), labeled_usage AS (
          SELECT CASE split_part(operation_key, ':', 1)
            WHEN 'ai-memory' THEN 'ai-memory'
            WHEN 'ai-memory-chat-edit' THEN 'ai-memory-chat-edit'
            WHEN 'ai-memory-chat-edit-intent' THEN 'ai-memory-chat-edit-intent'
            WHEN 'ai-memory-chat-forget' THEN 'ai-memory-chat-forget'
            WHEN 'ai-memory-event' THEN 'ai-memory-event'
            WHEN 'ai-memory-request' THEN 'ai-memory-request'
            WHEN 'memory-recall' THEN 'memory-recall'
            WHEN 'semantic-import' THEN 'semantic-import'
            ELSE 'unknown' END AS operation, evidence, attribution, cost, unrecorded_cost, attempt_status
          FROM usage_rows
        ), breakdown AS (
          SELECT operation, evidence, attribution, coalesce(sum(cost), 0) AS cost,
            count(cost) AS recorded, count(*) FILTER (WHERE attempt_status = 'released') AS released,
            count(*) FILTER (WHERE cost IS NULL AND unrecorded_cost IS NULL AND attempt_status <> 'released') AS uncosted,
            coalesce(sum(unrecorded_cost), 0) AS unrecorded_cost, count(unrecorded_cost) AS unrecorded
          FROM labeled_usage GROUP BY operation, evidence, attribution
        ), totals AS (
          SELECT coalesce(sum(cost), 0)::text AS "costMicroCents",
            coalesce(sum(recorded), 0)::double precision AS "recordedCostOperations",
            coalesce(sum(released), 0)::double precision AS "releasedReservations",
            coalesce(sum(uncosted), 0)::double precision AS "uncostedReservationAttempts",
            coalesce(sum(unrecorded_cost), 0)::text AS "unrecordedCostMicroCents",
            coalesce(sum(unrecorded), 0)::double precision AS "unrecordedCostReservations",
            coalesce(jsonb_agg(jsonb_build_object(
              'operation', operation, 'evidence', evidence, 'costMicroCents', cost::text,
              'attribution', attribution, 'recordedCostOperations', recorded, 'releasedReservations', released,
              'uncostedReservationAttempts', uncosted, 'unrecordedCostMicroCents', unrecorded_cost::text,
              'unrecordedCostReservations', unrecorded
            ) ORDER BY operation, evidence, attribution), '[]'::jsonb) AS breakdown
          FROM breakdown
        )
        SELECT CASE WHEN p.unlimited THEN 'unlimited' WHEN p.id IS NOT NULL THEN 'metered'
            ELSE 'unavailable' END AS mode,
          CASE WHEN p.id IS NOT NULL THEN jsonb_build_object(
            'start', to_char(p.period_start, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
            'end', to_char(p.period_end, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
          ) END AS period,
          totals.*
        FROM target LEFT JOIN period p ON true CROSS JOIN totals
    `;
  } catch {
    throw new Error("AI memory usage report query failed.");
  }
  if (report === undefined) {
    throw new Error("Target user does not exist.");
  }
  return report;
};
