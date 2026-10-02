import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  billingCreditUsageEvent,
  organization,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import type {
  MailSendSnapshot,
  ManagedMailRawObjectProvider,
} from "@quieter/database/schema";
import { and, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";

import { getBillingCreditUsage } from "./credits.ts";
import { getOrganizationBillingEntitlement } from "./entitlements.ts";
import {
  estimateOutboundOrganizationMailUsage,
  getOrganizationMailUsageSettings,
} from "./organization-mail-usage.ts";
import { applyManagedUsageMarkup } from "./ses-pricing.ts";

export const reserveOrganizationMailSend = async (input: {
  id: string;
  idempotencyKey: string;
  messageHeaderId: string;
  organizationId: string;
  rawObject: {
    bucket: string;
    key: string;
    provider: ManagedMailRawObjectProvider;
  };
  requestHash: string;
  snapshot: MailSendSnapshot;
}) => {
  const [entitlement, settings] = await Promise.all([
    getOrganizationBillingEntitlement({
      feature: "organizationMail",
      organizationId: input.organizationId,
    }),
    getOrganizationMailUsageSettings(input.organizationId),
  ]);
  const estimate = estimateOutboundOrganizationMailUsage({
    attachmentSizeBytes: input.snapshot.attachments.reduce(
      (size, attachment) => size + attachment.size,
      0
    ),
    bcc: input.snapshot.bcc,
    cc: input.snapshot.cc,
    html: input.snapshot.bodyHtml,
    subject: input.snapshot.subject,
    text: input.snapshot.bodyText,
    to: input.snapshot.to,
  });
  const estimatedCostMicroCents = applyManagedUsageMarkup({
    sesCostUsdMicroCents: estimate.sesCostMicroCents,
  });
  return await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, input.organizationId))
      .for("update");
    const [existing] = await tx
      .select()
      .from(organizationMailSendIdempotency)
      .where(
        and(
          eq(
            organizationMailSendIdempotency.organizationId,
            input.organizationId
          ),
          eq(
            organizationMailSendIdempotency.idempotencyKey,
            input.idempotencyKey
          )
        )
      )
      .limit(1);
    if (
      existing !== undefined &&
      ((existing.status !== "rejected" && existing.status !== "prepared") ||
        existing.requestHash !== input.requestHash)
    ) {
      return existing;
    }
    if (!entitlement.hasAccess) {
      throw new ORPCError("FORBIDDEN", {
        message: "Team mail requires Managed billing.",
      });
    }
    const { account } = entitlement;
    if (!entitlement.hasUnlimitedAccess) {
      if (account === null) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "The team's billing account is unavailable.",
        });
      }
      const usage = await getBillingCreditUsage(account, tx);
      const [reserved] = await tx
        .select({
          cost: sql`coalesce(sum(${organizationMailSendIdempotency.estimatedCostMicroCents}), 0)`.mapWith(
            Number
          ),
        })
        .from(organizationMailSendIdempotency)
        .leftJoin(
          billingCreditUsageEvent,
          eq(
            billingCreditUsageEvent.dedupeKey,
            sql`'mail:outbound:' || ${organizationMailSendIdempotency.organizationId} || ':' || (${organizationMailSendIdempotency.response}->>'messageId')`
          )
        )
        .where(
          and(
            eq(
              organizationMailSendIdempotency.organizationId,
              input.organizationId
            ),
            inArray(organizationMailSendIdempotency.status, [
              "prepared",
              "submitting",
              "accepted",
              "unknown",
            ]),
            gte(
              organizationMailSendIdempotency.createdAt,
              account.currentPeriodStart
            ),
            lt(
              organizationMailSendIdempotency.createdAt,
              account.currentPeriodEnd
            ),
            isNull(billingCreditUsageEvent.id),
            existing === undefined
              ? undefined
              : ne(organizationMailSendIdempotency.id, existing.id)
          )
        );
      const projectedOverage = Math.max(
        0,
        usage.costMicroCents +
          (reserved?.cost ?? 0) +
          estimatedCostMicroCents -
          usage.creditAmountMicroCents
      );
      if (projectedOverage > 0 && !settings.overageEnabled) {
        throw new ORPCError("FORBIDDEN", {
          message: "Usage beyond this team's monthly balance is disabled.",
        });
      }
      if (
        settings.monthlyOverageLimitMicroCents !== null &&
        projectedOverage > settings.monthlyOverageLimitMicroCents
      ) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "This team's usage limit has been reached for the billing period.",
        });
      }
    }
    const now = new Date();
    const snapshot = {
      ...(existing?.snapshot ?? input.snapshot),
      billingAccount:
        entitlement.hasUnlimitedAccess || account === null
          ? null
          : {
              ...account,
              currentPeriodEnd: account.currentPeriodEnd.toISOString(),
              currentPeriodStart: account.currentPeriodStart.toISOString(),
            },
    };
    if (existing !== undefined) {
      const [retried] = await tx
        .update(organizationMailSendIdempotency)
        .set({
          attemptedAt: null,
          createdAt: now,
          estimatedCostMicroCents,
          failureMessage: null,
          snapshot,
          status: "prepared",
          updatedAt: now,
        })
        .where(
          and(
            eq(organizationMailSendIdempotency.id, existing.id),
            eq(organizationMailSendIdempotency.status, existing.status)
          )
        )
        .returning();
      if (retried === undefined) {
        throw new ORPCError("CONFLICT", {
          message: "This send is no longer available.",
        });
      }
      return retried;
    }
    const [created] = await tx
      .insert(organizationMailSendIdempotency)
      .values({
        createdAt: now,
        estimatedCostMicroCents,
        id: input.id,
        idempotencyKey: input.idempotencyKey,
        messageHeaderId: input.messageHeaderId,
        organizationId: input.organizationId,
        rawObjectBucket: input.rawObject.bucket,
        rawObjectKey: input.rawObject.key,
        rawObjectProvider: input.rawObject.provider,
        requestHash: input.requestHash,
        snapshot,
        status: "prepared",
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();
    if (created === undefined) {
      throw new ORPCError("CONFLICT", {
        message:
          "This send is already being processed. Retry with the same request.",
      });
    }
    return created;
  });
};
