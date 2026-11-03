import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import postgres from "postgres";

import type {
  billingCreditUsageEvent,
  billingEntitlementOverride,
  organization,
} from "../src/schema.ts";
import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";

type LedgerEventRow = Omit<
  typeof billingCreditUsageEvent.$inferSelect,
  "billableCostMicroCents" | "chargeableCostMicroCents" | "costMicroCents"
> & {
  billableCostMicroCents: string;
  chargeableCostMicroCents: string | null;
  costMicroCents: string;
};

const { values } = parseArgs({
  options: {
    "accept-unfunded-owned-organizations": { type: "boolean" },
    action: { default: "inspect", type: "string" },
    "event-id": { type: "string" },
    "expires-at": { type: "string" },
    operator: { type: "string" },
    permanent: { type: "boolean" },
    reason: { type: "string" },
    "user-id": { type: "string" },
  },
  strict: true,
});
const userId = values["user-id"]?.trim();
if (!userId || userId.length > 200 || /\s/u.test(userId)) {
  throw new Error("An exact --user-id is required.");
}
if (
  !["inspect", "grant-unlimited", "write-off-deferred"].includes(values.action)
) {
  throw new Error(
    "Action must be inspect, grant-unlimited, or write-off-deferred."
  );
}
const writingOff = values.action === "write-off-deferred";
const eventId = values["event-id"]?.trim();
if (
  (writingOff && !eventId) ||
  (eventId !== undefined &&
    (!eventId || eventId.length > 200 || /\s/u.test(eventId)))
) {
  throw new Error("An exact --event-id is required for write-off-deferred.");
}
if (values.action === "grant-unlimited" && eventId !== undefined) {
  throw new Error("Grant does not accept --event-id.");
}
const granting = values.action === "grant-unlimited";
const expiresAt = values["expires-at"] ? new Date(values["expires-at"]) : null;
if (
  granting &&
  (Boolean(values.permanent) === Boolean(expiresAt) ||
    (expiresAt !== null &&
      (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date())))
) {
  throw new Error(
    "Choose exactly one of --permanent or a future --expires-at."
  );
}
if (
  !granting &&
  (values.permanent === true ||
    expiresAt ||
    values["accept-unfunded-owned-organizations"] === true)
) {
  throw new Error("Only grants accept duration or funding options.");
}
const reason = values.reason?.trim() ?? "";
const operator = values.operator?.trim() ?? "";
if (
  (granting || writingOff) &&
  (!reason ||
    reason.length > 500 ||
    !operator ||
    operator.length > 200 ||
    /[\r\n]/u.test(`${reason}${operator}`))
) {
  throw new Error(
    "Mutation requires a single-line --reason and --operator audit reference."
  );
}
const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);
const runUrl =
  process.env.GITHUB_ACTIONS === "true"
    ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : "local-development";
const sql = postgres(databaseUrl, {
  max: 1,
  prepare: false,
});
try {
  const result = await sql.begin(
    granting || writingOff ? "" : "read only",
    async (transaction) => {
      const users =
        granting || writingOff
          ? await transaction`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`
          : await transaction`SELECT id FROM "user" WHERE id = ${userId}`;
      if (users.length !== 1) {
        throw new Error("Target user does not exist.");
      }
      if (eventId !== undefined) {
        const events = writingOff
          ? await transaction<LedgerEventRow[]>`
              SELECT * FROM "billingCreditUsageEvent" WHERE id = ${eventId} FOR UPDATE`
          : await transaction<LedgerEventRow[]>`
              SELECT * FROM "billingCreditUsageEvent" WHERE id = ${eventId}`;
        const [event] = events;
        if (event === undefined || event.userId !== userId) {
          throw new Error(
            "Event must belong to the exact frozen payer. Legacy events without a frozen payer require provider reconciliation."
          );
        }
        if (!writingOff) {
          return {
            billableCostMicroCents: event.billableCostMicroCents,
            deferredReason: event.polarEventDeferredReason,
            providerAttempted: event.polarEventAttemptedAt !== null,
            providerReported: event.polarEventReportedAt !== null,
            writtenOff: event.liabilityWrittenOffAt !== null,
          };
        }
        if (event.liabilityWrittenOffAt !== null) {
          return { alreadyResolved: true, writtenOff: true };
        }
        if (
          event.liabilityWriteOff !== null ||
          event.polarEventReportedAt !== null ||
          event.polarEventAttemptedAt !== null ||
          event.polarEventDeferredAt === null ||
          event.polarEventDeferredReason === null ||
          Number(event.billableCostMicroCents) <= 0 ||
          event.chargeableCostMicroCents === null
        ) {
          throw new Error(
            "Only deferred, positive, never-attempted liability may be written off. Reconcile attempted or ambiguous events with the provider."
          );
        }
        const originalBillableCostMicroCents = Number(
          event.billableCostMicroCents
        );
        const originalChargeableCostMicroCents = Number(
          event.chargeableCostMicroCents
        );
        if (
          !Number.isSafeInteger(originalBillableCostMicroCents) ||
          !Number.isSafeInteger(originalChargeableCostMicroCents) ||
          originalChargeableCostMicroCents < originalBillableCostMicroCents
        ) {
          throw new Error("Event has invalid financial amounts.");
        }
        const audit = {
          operator,
          originalBillableCostMicroCents,
          originalChargeableCostMicroCents,
          originalEvent: {
            ...event,
            billingPeriodEnd: event.billingPeriodEnd?.toISOString() ?? null,
            billingPeriodStart: event.billingPeriodStart?.toISOString() ?? null,
            createdAt: event.createdAt.toISOString(),
            liabilityWriteOff: event.liabilityWriteOff,
            liabilityWrittenOffAt: event.liabilityWrittenOffAt,
            polarEventAttemptedAt: event.polarEventAttemptedAt,
            polarEventDeferredAt:
              event.polarEventDeferredAt?.toISOString() ?? null,
            polarEventReportedAt: event.polarEventReportedAt,
          },
          reason,
          runUrl,
        };
        await transaction`
          UPDATE "billingCreditUsageEvent" SET "billableCostMicroCents" = 0,
            "chargeableCostMicroCents" = ${Math.max(0, originalChargeableCostMicroCents - originalBillableCostMicroCents)},
            "liabilityWrittenOffAt" = now(), "liabilityWriteOff" = ${transaction.json(audit)}::jsonb
          WHERE id = ${eventId}`;
        return { alreadyResolved: false, writtenOff: true };
      }
      const closing = await transaction`
      SELECT 1 FROM "billingAccountSettings"
      WHERE "userId" = ${userId} AND "deletionRequestedAt" IS NOT NULL
    `;
      if (granting && closing.length > 0) {
        throw new Error("Cannot grant access to a closing billing account.");
      }
      const organizations = granting
        ? await transaction<
            Pick<
              typeof organization.$inferSelect,
              "id" | "billingOwnerUserId" | "billingDeletionRequestedAt"
            >[]
          >`
          SELECT o.id, o."billingOwnerUserId", o."billingDeletionRequestedAt"
          FROM organization o WHERE o."billingOwnerUserId" = ${userId}
          OR (o."billingOwnerUserId" IS NULL AND EXISTS (
            SELECT 1 FROM member m WHERE m."organizationId" = o.id
            AND m."userId" = ${userId} AND 'owner' = ANY(string_to_array(m.role, ','))
          )) ORDER BY o.id FOR UPDATE OF o
        `
        : await transaction<
            Pick<
              typeof organization.$inferSelect,
              "id" | "billingOwnerUserId" | "billingDeletionRequestedAt"
            >[]
          >`
          SELECT o.id, o."billingOwnerUserId", o."billingDeletionRequestedAt"
          FROM organization o WHERE o."billingOwnerUserId" = ${userId}
          OR (o."billingOwnerUserId" IS NULL AND EXISTS (
            SELECT 1 FROM member m WHERE m."organizationId" = o.id
            AND m."userId" = ${userId} AND 'owner' = ANY(string_to_array(m.role, ','))
          )) ORDER BY o.id
        `;
      const audit = JSON.stringify({
        acceptedFundingOrganizationIds:
          values["accept-unfunded-owned-organizations"] === true
            ? organizations
                .filter((team) => team.billingOwnerUserId === null)
                .map((team) => team.id)
            : [],
        operator,
        reason,
        runUrl,
      });
      const active = await transaction<
        Pick<
          typeof billingEntitlementOverride.$inferSelect,
          "id" | "plan" | "expiresAt"
        >[]
      >`
      SELECT id, plan, "expiresAt" FROM "billingEntitlementOverride"
      WHERE "userId" = ${userId} AND "revokedAt" IS NULL
      AND ("expiresAt" IS NULL OR "expiresAt" > now())
      ORDER BY "updatedAt" DESC, id
    `;
      let fundedOrganizations = 0;
      let grantChanged = false;
      if (granting) {
        if (values["accept-unfunded-owned-organizations"] === true) {
          for (const team of organizations) {
            if (team.billingOwnerUserId !== null) {
              continue;
            }
            if (team.billingDeletionRequestedAt !== null) {
              throw new Error("An unfunded owned organization is closing.");
            }
            const updated = await transaction`
            UPDATE organization o SET "billingOwnerUserId" = ${userId}, "updatedAt" = now()
            WHERE o.id = ${team.id} AND o."billingOwnerUserId" IS NULL
            AND EXISTS (SELECT 1 FROM member m WHERE m."organizationId" = o.id
              AND m."userId" = ${userId} AND 'owner' = ANY(string_to_array(m.role, ','))) RETURNING o.id
          `;
            if (updated.length !== 1) {
              throw new Error(
                "Ownership changed. Inspect again before retrying."
              );
            }
            fundedOrganizations += 1;
          }
        }
        const retained = active.find(
          (entry) =>
            entry.plan === "pro" &&
            entry.expiresAt?.getTime() === expiresAt?.getTime()
        );
        if (retained === undefined || active.length !== 1) {
          await transaction`
          UPDATE "billingEntitlementOverride" SET "revokedAt" = now(), "updatedAt" = now(),
            reason = reason || E'\n' || ${audit}
          WHERE "userId" = ${userId} AND "revokedAt" IS NULL
          AND ("expiresAt" IS NULL OR "expiresAt" > now())
          AND id <> ${retained?.id ?? ""}
        `;
          if (retained === undefined) {
            await transaction`
            INSERT INTO "billingEntitlementOverride"
              (id, "userId", plan, reason, "expiresAt", "createdAt", "updatedAt")
            VALUES (${randomUUID()}, ${userId}, 'pro', ${audit}, ${expiresAt}, now(), now())
          `;
          }
          grantChanged = true;
        }
        if (retained !== undefined && fundedOrganizations > 0) {
          await transaction`
          UPDATE "billingEntitlementOverride" SET reason = reason || E'\n' || ${audit},
            "updatedAt" = now() WHERE id = ${retained.id}
        `;
        }
      }
      return {
        accountClosing: closing.length > 0,
        activeOverrides: granting ? 1 : active.length,
        fundedOrganizations,
        grantChanged,
        ownedUnfundedOrganizations:
          organizations.filter((team) => team.billingOwnerUserId === null)
            .length - fundedOrganizations,
        permanentUnlimited: granting
          ? expiresAt === null
          : closing.length === 0 &&
            active[0]?.plan === "pro" &&
            active[0].expiresAt === null,
        unlimited:
          closing.length === 0 && (granting || active[0]?.plan === "pro"),
        userExists: true,
      };
    }
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await sql.end();
}
