import { randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import {
  organizationCampaign,
  organizationCampaignRecipient,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { reportError } from "@quieter/observability";
import { and, asc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";

import { checkAudienceRecipientEligibility } from "../audiences/eligibility";
import { assertLocalMailSend } from "../local-managed-mail";
import { sendOrganizationMailMessage } from "../organization-mail";
import { OrganizationMailSendError } from "../organization-mail-policy";
import { resolveCampaignDeliveryState } from "./delivery-state";

export const processCampaignBatch = async (
  options: { campaignId?: string; dryRun?: boolean; limit?: number } = {}
) => {
  const limit = Math.max(1, Math.min(options.limit ?? 10, 25));
  if (options.dryRun === true) {
    const recipients = await db
      .select({
        audienceId: organizationCampaign.audienceId,
        recipient: organizationCampaignRecipient,
      })
      .from(organizationCampaignRecipient)
      .innerJoin(
        organizationCampaign,
        eq(organizationCampaign.id, organizationCampaignRecipient.campaignId)
      )
      .where(
        and(
          eq(organizationCampaignRecipient.status, "pending"),
          inArray(organizationCampaign.status, ["queued", "sending"]),
          options.campaignId === undefined
            ? undefined
            : eq(organizationCampaign.id, options.campaignId)
        )
      )
      .orderBy(asc(organizationCampaignRecipient.createdAt))
      .limit(limit);
    let eligible = 0;
    for (const { recipient, audienceId } of recipients) {
      if (
        await checkAudienceRecipientEligibility({
          audienceId,
          email: recipient.email,
          membershipId: recipient.membershipId,
          organizationId: recipient.organizationId,
        })
      ) {
        eligible += 1;
      }
    }
    return {
      considered: recipients.length,
      dryRun: true,
      eligible,
      excluded: recipients.length - eligible,
      processed: 0,
    };
  }
  assertLocalMailSend();
  const origin = serverEnv.BETTER_AUTH_URL;
  if (origin === undefined || new URL(origin).protocol !== "https:") {
    throw new Error("Campaign unsubscribe origin is not configured.");
  }
  const recovered = await db
    .select({
      recipientId: organizationCampaignRecipient.id,
      response: organizationMailSendIdempotency.response,
    })
    .from(organizationCampaignRecipient)
    .innerJoin(
      organizationMailSendIdempotency,
      and(
        eq(
          organizationCampaignRecipient.organizationId,
          organizationMailSendIdempotency.organizationId
        ),
        eq(
          organizationCampaignRecipient.sendKey,
          organizationMailSendIdempotency.idempotencyKey
        )
      )
    )
    .where(
      and(
        inArray(organizationCampaignRecipient.status, ["sending", "uncertain"]),
        inArray(organizationMailSendIdempotency.status, [
          "accepted",
          "completed",
        ])
      )
    )
    .limit(100);
  for (const row of recovered) {
    if (row.response?.messageId) {
      await db
        .update(organizationCampaignRecipient)
        .set({
          providerMessageId: row.response.messageId,
          status: "sent",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationCampaignRecipient.id, row.recipientId),
            inArray(organizationCampaignRecipient.status, [
              "sending",
              "uncertain",
            ])
          )
        );
    }
  }
  const now = new Date();
  const confirmedCampaigns = await db
    .select({ id: organizationCampaign.id })
    .from(organizationCampaign)
    .where(
      and(
        eq(organizationCampaign.status, "paused"),
        sql`not exists (select 1 from ${organizationCampaignRecipient} where ${organizationCampaignRecipient.campaignId} = ${organizationCampaign.id} and ${organizationCampaignRecipient.status} in ('pending', 'sending', 'uncertain', 'failed'))`
      )
    )
    .limit(25);
  if (confirmedCampaigns.length > 0) {
    await db
      .update(organizationCampaign)
      .set({ status: "completed", updatedAt: now })
      .where(
        and(
          inArray(
            organizationCampaign.id,
            confirmedCampaigns.map((campaign) => campaign.id)
          ),
          eq(organizationCampaign.status, "paused")
        )
      );
  }
  const abandoned = await db
    .select({ recipient: organizationCampaignRecipient })
    .from(organizationCampaignRecipient)
    .innerJoin(
      organizationCampaign,
      eq(organizationCampaign.id, organizationCampaignRecipient.campaignId)
    )
    .where(
      and(
        eq(organizationCampaign.status, "canceled"),
        eq(organizationCampaignRecipient.status, "sending"),
        lte(
          organizationCampaignRecipient.updatedAt,
          new Date(now.getTime() - 180_000)
        ),
        or(
          isNull(organizationCampaign.leaseExpiresAt),
          lte(organizationCampaign.leaseExpiresAt, now)
        )
      )
    )
    .orderBy(asc(organizationCampaignRecipient.updatedAt))
    .limit(100);
  for (const { recipient } of abandoned) {
    const [operation] = await db
      .select()
      .from(organizationMailSendIdempotency)
      .where(
        and(
          eq(
            organizationMailSendIdempotency.organizationId,
            recipient.organizationId
          ),
          eq(organizationMailSendIdempotency.idempotencyKey, recipient.sendKey)
        )
      )
      .limit(1);
    const accepted =
      operation?.status === "accepted" || operation?.status === "completed";
    await db
      .update(organizationCampaignRecipient)
      .set({
        providerMessageId: accepted ? operation.response?.messageId : null,
        status: resolveCampaignDeliveryState({
          attempts: recipient.attempts,
          canceled: true,
          eligible: true,
          hasSendOperation: recipient.sendOperationId !== null,
          interrupted: true,
          operationStatus: operation?.status,
          recipientStatus: "sending",
        }),
        updatedAt: now,
      })
      .where(
        and(
          eq(organizationCampaignRecipient.id, recipient.id),
          eq(organizationCampaignRecipient.status, "sending"),
          eq(organizationCampaignRecipient.updatedAt, recipient.updatedAt)
        )
      );
  }
  const leaseToken = randomUUID();
  const campaign = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(organizationCampaign)
      .where(
        and(
          inArray(organizationCampaign.status, ["queued", "sending"]),
          or(
            isNull(organizationCampaign.leaseExpiresAt),
            lte(organizationCampaign.leaseExpiresAt, now)
          ),
          options.campaignId === undefined
            ? undefined
            : eq(organizationCampaign.id, options.campaignId)
        )
      )
      .orderBy(asc(organizationCampaign.updatedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (row === undefined) {
      return null;
    }
    await tx
      .update(organizationCampaign)
      .set({
        leaseExpiresAt: new Date(now.getTime() + 180_000),
        leaseToken,
        status: "sending",
        updatedAt: now,
      })
      .where(eq(organizationCampaign.id, row.id));
    return row;
  });
  if (campaign === null) {
    return { processed: 0 };
  }
  let processed = 0;
  try {
    const stale = await db
      .select()
      .from(organizationCampaignRecipient)
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, campaign.id),
          inArray(organizationCampaignRecipient.status, [
            "sending",
            "uncertain",
          ])
        )
      )
      .limit(100);
    for (const recipient of stale) {
      const [operation] = await db
        .select()
        .from(organizationMailSendIdempotency)
        .where(
          and(
            eq(
              organizationMailSendIdempotency.organizationId,
              campaign.organizationId
            ),
            eq(
              organizationMailSendIdempotency.idempotencyKey,
              recipient.sendKey
            )
          )
        )
        .limit(1);
      const accepted =
        operation?.status === "accepted" || operation?.status === "completed";
      await db
        .update(organizationCampaignRecipient)
        .set({
          providerMessageId: accepted
            ? operation.response?.messageId
            : recipient.providerMessageId,
          sendOperationId: operation?.id,
          status: resolveCampaignDeliveryState({
            attempts: recipient.attempts,
            canceled: false,
            eligible: true,
            hasSendOperation: recipient.sendOperationId !== null,
            interrupted: true,
            operationStatus: operation?.status,
            recipientStatus:
              recipient.status === "uncertain" ? "uncertain" : "sending",
          }),
          updatedAt: new Date(),
        })
        .where(eq(organizationCampaignRecipient.id, recipient.id));
    }
    const recipients = await db
      .select()
      .from(organizationCampaignRecipient)
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, campaign.id),
          eq(organizationCampaignRecipient.status, "pending"),
          lte(organizationCampaignRecipient.nextAttemptAt, now)
        )
      )
      .orderBy(asc(organizationCampaignRecipient.createdAt))
      .limit(limit);
    for (const recipient of recipients) {
      if (Date.now() - now.getTime() > 45_000) {
        break;
      }
      const [active] = await db
        .select({ id: organizationCampaign.id })
        .from(organizationCampaign)
        .where(
          and(
            eq(organizationCampaign.id, campaign.id),
            eq(organizationCampaign.leaseToken, leaseToken),
            eq(organizationCampaign.status, "sending")
          )
        );
      if (active === undefined) {
        break;
      }
      if (
        !(await checkAudienceRecipientEligibility({
          audienceId: campaign.audienceId,
          email: recipient.email,
          membershipId: recipient.membershipId,
          organizationId: campaign.organizationId,
        }))
      ) {
        await db
          .update(organizationCampaignRecipient)
          .set({
            exclusionReason:
              "Subscription or safety status changed before sending.",
            status: "excluded",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(organizationCampaignRecipient.id, recipient.id),
              eq(organizationCampaignRecipient.status, "pending")
            )
          );
        continue;
      }
      const [claimed] = await db
        .update(organizationCampaignRecipient)
        .set({
          attempts: sql`${organizationCampaignRecipient.attempts} + 1`,
          status: "sending",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationCampaignRecipient.id, recipient.id),
            eq(organizationCampaignRecipient.status, "pending")
          )
        )
        .returning();
      if (claimed === undefined) {
        continue;
      }
      const unsubscribeUrl = new URL(
        `/api/v1/unsubscribe/${recipient.unsubscribeToken}`,
        origin
      ).toString();
      try {
        const result = await sendOrganizationMailMessage({
          beforeSubmit: async (operationId) => {
            const [current] = await db
              .select({
                leaseToken: organizationCampaign.leaseToken,
                status: organizationCampaign.status,
              })
              .from(organizationCampaign)
              .where(eq(organizationCampaign.id, campaign.id));
            const [currentRecipient] = await db
              .select({ status: organizationCampaignRecipient.status })
              .from(organizationCampaignRecipient)
              .where(eq(organizationCampaignRecipient.id, recipient.id));
            if (
              current?.status !== "sending" ||
              current.leaseToken !== leaseToken ||
              currentRecipient?.status !== "sending" ||
              !(await checkAudienceRecipientEligibility({
                audienceId: campaign.audienceId,
                email: recipient.email,
                membershipId: recipient.membershipId,
                organizationId: campaign.organizationId,
              }))
            ) {
              throw new Error(
                "Campaign recipient is no longer eligible for delivery."
              );
            }
            await db
              .update(organizationCampaignRecipient)
              .set({ sendOperationId: operationId })
              .where(eq(organizationCampaignRecipient.id, recipient.id));
          },
          message: sendMessageInputSchema.parse({
            from: campaign.from,
            headers: {
              "List-Unsubscribe": `<${unsubscribeUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
            idempotencyKey: recipient.sendKey,
            subject: campaign.subject,
            text: `${campaign.text}\n\nUnsubscribe from this audience: ${unsubscribeUrl}`,
            to: [recipient.email],
          }),
          organizationId: campaign.organizationId,
        });
        await db
          .update(organizationCampaignRecipient)
          .set({
            providerMessageId: result.messageId,
            status: "sent",
            updatedAt: new Date(),
          })
          .where(eq(organizationCampaignRecipient.id, recipient.id));
      } catch (error) {
        const [operation] = await db
          .select()
          .from(organizationMailSendIdempotency)
          .where(
            and(
              eq(
                organizationMailSendIdempotency.organizationId,
                campaign.organizationId
              ),
              eq(
                organizationMailSendIdempotency.idempotencyKey,
                recipient.sendKey
              )
            )
          )
          .limit(1);
        const accepted =
          operation?.status === "accepted" || operation?.status === "completed";
        const [currentCampaign] = await db
          .select({ status: organizationCampaign.status })
          .from(organizationCampaign)
          .where(eq(organizationCampaign.id, campaign.id));
        const eligible = await checkAudienceRecipientEligibility({
          audienceId: campaign.audienceId,
          email: recipient.email,
          membershipId: recipient.membershipId,
          organizationId: campaign.organizationId,
        });
        const canceled = currentCampaign?.status === "canceled";
        if (operation?.status === "prepared" && (!eligible || canceled)) {
          await db
            .update(organizationMailSendIdempotency)
            .set({ status: "rejected", updatedAt: new Date() })
            .where(
              and(
                eq(organizationMailSendIdempotency.id, operation.id),
                eq(organizationMailSendIdempotency.status, "prepared")
              )
            );
        }
        await db
          .update(organizationCampaignRecipient)
          .set({
            exclusionReason: eligible
              ? null
              : "Subscription or safety status changed before sending.",
            nextAttemptAt: new Date(
              Date.now() + 60_000 * 2 ** claimed.attempts
            ),
            providerMessageId: accepted ? operation.response?.messageId : null,
            sendOperationId: operation?.id,
            status: resolveCampaignDeliveryState({
              attempts: claimed.attempts,
              canceled,
              eligible,
              hasSendOperation: recipient.sendOperationId !== null,
              interrupted: false,
              operationStatus: operation?.status,
              recipientStatus: "sending",
            }),
            updatedAt: new Date(),
          })
          .where(eq(organizationCampaignRecipient.id, recipient.id));
        if (
          eligible &&
          !canceled &&
          !(
            (error instanceof OrganizationMailSendError ||
              error instanceof ORPCError) &&
            error.status < 500
          )
        ) {
          reportError(error, { operation: "campaign:send-recipient" });
        }
      }
      processed += 1;
    }
    const [remaining] = await db
      .select({ id: organizationCampaignRecipient.id })
      .from(organizationCampaignRecipient)
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, campaign.id),
          inArray(organizationCampaignRecipient.status, ["pending", "sending"])
        )
      )
      .limit(1);
    const [failed] = await db
      .select({ id: organizationCampaignRecipient.id })
      .from(organizationCampaignRecipient)
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, campaign.id),
          inArray(organizationCampaignRecipient.status, ["failed", "uncertain"])
        )
      )
      .limit(1);
    let status: "queued" | "paused" | "completed" = "queued";
    if (remaining === undefined) {
      status = failed === undefined ? "completed" : "paused";
    }
    await db
      .update(organizationCampaign)
      .set({
        status,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationCampaign.id, campaign.id),
          eq(organizationCampaign.leaseToken, leaseToken),
          eq(organizationCampaign.status, "sending")
        )
      );
  } finally {
    await db
      .update(organizationCampaign)
      .set({ leaseExpiresAt: null, leaseToken: null })
      .where(
        and(
          eq(organizationCampaign.id, campaign.id),
          eq(organizationCampaign.leaseToken, leaseToken)
        )
      );
  }
  return { processed };
};
