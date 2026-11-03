import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  aiCreditReservation,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import type {
  MailSendSnapshot,
  ManagedMailRawObjectProvider,
} from "@quieter/database/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

import {
  assertBillingMoney,
  calculateBillingLiability,
  getBillingBudget,
} from "./budget.ts";
import { lockBillingAccount } from "./credits.ts";
import { getOrganizationBillingEntitlement } from "./entitlements.ts";
import { estimateOutboundOrganizationMailUsage } from "./organization-mail-usage.ts";
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
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
    organizationId: input.organizationId,
  });
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
  assertBillingMoney(estimatedCostMicroCents);
  return await db.transaction(async (tx) => {
    await lockBillingAccount(
      entitlement.account ?? {
        organizationId: input.organizationId,
      },
      tx,
      { admission: true }
    );
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
      existing === undefined &&
      input.snapshot.kind === "mailbox" &&
      input.snapshot.mailboxId !== undefined &&
      input.snapshot.draftId !== undefined &&
      input.snapshot.draftUpdatedAt !== undefined
    ) {
      const [boundSend] = await tx
        .select()
        .from(organizationMailSendIdempotency)
        .where(
          and(
            eq(
              organizationMailSendIdempotency.organizationId,
              input.organizationId
            ),
            sql`${organizationMailSendIdempotency.snapshot}->>'mailboxId' = ${input.snapshot.mailboxId}`,
            sql`${organizationMailSendIdempotency.snapshot}->>'draftId' = ${input.snapshot.draftId}`,
            sql`${organizationMailSendIdempotency.snapshot}->>'draftUpdatedAt' = ${input.snapshot.draftUpdatedAt}`,
            inArray(organizationMailSendIdempotency.status, [
              "prepared",
              "submitting",
              "unknown",
              "accepted",
              "completed",
            ])
          )
        )
        .limit(1);
      if (boundSend !== undefined) {
        return boundSend;
      }
    }
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
      const budget = await getBillingBudget(account, tx, {
        mailSendId: existing?.id,
      });
      const [openAi] = await tx
        .select({ id: aiCreditReservation.id })
        .from(aiCreditReservation)
        .where(
          and(
            account.scope === "account" &&
              account.billingOwnerUserId !== undefined
              ? eq(
                  aiCreditReservation.billingUserId,
                  account.billingOwnerUserId
                )
              : eq(aiCreditReservation.organizationId, account.organizationId),
            eq(aiCreditReservation.status, "reserved")
          )
        )
        .limit(1);
      if (openAi !== undefined) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "Wait for the current AI request to finish before sending team mail.",
        });
      }
      const liability = calculateBillingLiability({
        ...budget,
        costMicroCents: estimatedCostMicroCents,
      });
      if (liability.chargeableCostMicroCents < estimatedCostMicroCents) {
        throw new ORPCError("FORBIDDEN", {
          message:
            "The usage balance or spending limit has been reached for this billing period.",
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
              authorizedCostMicroCents: estimatedCostMicroCents,
              currentPeriodEnd: account.currentPeriodEnd.toISOString(),
              currentPeriodStart: account.currentPeriodStart.toISOString(),
            },
    };
    if (existing !== undefined) {
      const [retried] = await tx
        .update(organizationMailSendIdempotency)
        .set({
          attemptedAt: null,
          billingUserId: account?.billingOwnerUserId ?? null,
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
        billingUserId: account?.billingOwnerUserId ?? null,
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
