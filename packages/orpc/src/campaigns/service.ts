import { randomBytes, randomUUID } from "node:crypto";

import { ORPCError } from "@orpc/server";
import { getOrganizationBillingEntitlement } from "@quieter/billing/entitlements";
import { estimateOutboundOrganizationMailUsage } from "@quieter/billing/organization-mail-usage";
import { applyManagedUsageMarkup } from "@quieter/billing/ses-pricing";
import { db } from "@quieter/database/client";
import type { DatabaseExecutor } from "@quieter/database/client";
import {
  mailDomain,
  organization,
  organizationAudienceSegment,
  organizationCampaign,
  organizationCampaignRecipient,
  organizationMailDeliveryEvent,
  organizationMailDeliveryRecipient,
} from "@quieter/database/schema";
import { campaignSchema } from "@quieter/mail/campaigns";
import type {
  campaignCreateInputSchema,
  campaignUpdateInputSchema,
  campaignGetInputSchema,
  campaignSendInputSchema,
  campaignListInputSchema,
} from "@quieter/mail/campaigns";
import { sendMessageInputSchema } from "@quieter/mail/send";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import {
  loadSegmentCriteria,
  lockAudienceForSnapshot,
  selectAudienceRecipients,
} from "../audiences/eligibility";
import { unsubscribeAudienceMembership } from "../audiences/subscriptions";
import { assertGrowthAccess } from "../growth-access";
import type { GrowthActor } from "../growth-access";
import { assertOrganizationOwnsVerifiedSenderDomain } from "../organization-mail-policy";
import { hashRequest } from "../request-hash";

type CampaignRow = typeof organizationCampaign.$inferSelect;
type CampaignInput = { campaignId: string; organizationId: string };

const serializeCampaign = (row: CampaignRow) =>
  campaignSchema.parse({
    ...row,
    createdAt: row.createdAt.toISOString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  });

export const loadCampaign = async (
  organizationId: string,
  campaignId: string,
  database: DatabaseExecutor = db
) => {
  const [row] = await database
    .select()
    .from(organizationCampaign)
    .where(
      and(
        eq(organizationCampaign.id, campaignId),
        eq(organizationCampaign.organizationId, organizationId)
      )
    )
    .limit(1);
  if (row === undefined) {
    throw new ORPCError("NOT_FOUND", { message: "Campaign not found." });
  }
  return row;
};

export const listCampaigns = async (
  actor: GrowthActor,
  input: z.infer<typeof campaignListInputSchema>
) => {
  await assertGrowthAccess(actor, "campaigns:read");
  const rows = await db
    .select()
    .from(organizationCampaign)
    .where(eq(organizationCampaign.organizationId, actor.organizationId))
    .orderBy(desc(organizationCampaign.createdAt))
    .offset(input.offset)
    .limit(input.limit);
  const [total] = await db
    .select({ count: count() })
    .from(organizationCampaign)
    .where(eq(organizationCampaign.organizationId, actor.organizationId));
  const totalCount = total?.count ?? 0;
  return {
    campaigns: rows.map(serializeCampaign),
    nextOffset:
      input.offset + rows.length < totalCount
        ? input.offset + rows.length
        : null,
    totalCount,
  };
};

export const createCampaign = async (
  actor: GrowthActor,
  input: z.infer<typeof campaignCreateInputSchema>
) => {
  await assertGrowthAccess(actor, "campaigns:write");
  return await db.transaction(async (tx) => {
    await lockAudienceForSnapshot(tx, actor.organizationId, input.audienceId);
    await Promise.all(
      input.segmentIds.map(
        async (segmentId) =>
          await loadSegmentCriteria(tx, {
            audienceId: input.audienceId,
            organizationId: actor.organizationId,
            segmentId,
          })
      )
    );
    const now = new Date();
    const [row] = await tx
      .insert(organizationCampaign)
      .values({
        ...input,
        createdAt: now,
        id: randomUUID(),
        organizationId: actor.organizationId,
        updatedAt: now,
      })
      .returning();
    if (row === undefined) {
      throw new Error("Campaign creation failed.");
    }
    return serializeCampaign(row);
  });
};

export const updateCampaign = async (
  actor: GrowthActor,
  input: z.infer<typeof campaignUpdateInputSchema>
) => {
  await assertGrowthAccess(actor, "campaigns:write");
  return await db.transaction(async (tx) => {
    await lockAudienceForSnapshot(tx, actor.organizationId, input.audienceId);
    await Promise.all(
      input.segmentIds.map(
        async (segmentId) =>
          await loadSegmentCriteria(tx, {
            audienceId: input.audienceId,
            organizationId: actor.organizationId,
            segmentId,
          })
      )
    );
    const [row] = await tx
      .update(organizationCampaign)
      .set({
        audienceId: input.audienceId,
        from: input.from,
        name: input.name,
        segmentIds: input.segmentIds,
        subject: input.subject,
        text: input.text,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationCampaign.id, input.campaignId),
          eq(organizationCampaign.organizationId, actor.organizationId),
          eq(organizationCampaign.status, "draft"),
          eq(organizationCampaign.updatedAt, new Date(input.expectedUpdatedAt))
        )
      )
      .returning();
    if (row === undefined) {
      throw new ORPCError("CONFLICT", {
        message: "Only saved drafts can be edited.",
      });
    }
    return serializeCampaign(row);
  });
};

export const previewCampaign = async (
  actor: GrowthActor,
  input: CampaignInput
) => {
  await assertGrowthAccess(actor, "campaigns:read");
  const initialCampaign = await loadCampaign(
    actor.organizationId,
    input.campaignId
  );
  const { campaign, recipients, previewToken } = await db.transaction(
    async (tx) => {
      await lockAudienceForSnapshot(
        tx,
        actor.organizationId,
        initialCampaign.audienceId
      );
      const currentDraft = await loadCampaign(
        actor.organizationId,
        input.campaignId,
        tx
      );
      if (
        currentDraft.audienceId !== initialCampaign.audienceId ||
        currentDraft.status !== "draft"
      ) {
        throw new ORPCError("CONFLICT", {
          message: "The draft changed. Review it again before sending.",
        });
      }
      const selectedRecipients = await selectAudienceRecipients(tx, {
        audienceId: currentDraft.audienceId,
        organizationId: actor.organizationId,
        segmentIds: currentDraft.segmentIds,
      });
      const segments =
        currentDraft.segmentIds.length === 0
          ? []
          : await tx
              .select({
                criteria: organizationAudienceSegment.criteria,
                id: organizationAudienceSegment.id,
              })
              .from(organizationAudienceSegment)
              .where(
                and(
                  eq(
                    organizationAudienceSegment.organizationId,
                    actor.organizationId
                  ),
                  inArray(
                    organizationAudienceSegment.id,
                    currentDraft.segmentIds
                  )
                )
              )
              .orderBy(asc(organizationAudienceSegment.id));
      return {
        campaign: currentDraft,
        previewToken: hashRequest({
          campaign: serializeCampaign(currentDraft),
          recipients: selectedRecipients,
          segments,
        }),
        recipients: selectedRecipients,
      };
    }
  );
  const domains = await db
    .select({ domain: mailDomain.domain })
    .from(mailDomain)
    .where(
      and(
        eq(mailDomain.organizationId, actor.organizationId),
        eq(mailDomain.status, "verified")
      )
    );
  const eligibleCount = recipients.filter(
    (recipient) => recipient.eligible
  ).length;
  const exclusions: Record<string, number> = {};
  for (const recipient of recipients) {
    if (!recipient.eligible) {
      const reason = recipient.exclusionReason ?? "ineligible";
      exclusions[reason] = (exclusions[reason] ?? 0) + 1;
    }
  }
  const estimate = estimateOutboundOrganizationMailUsage({
    attachmentSizeBytes: 0,
    bcc: [],
    cc: [],
    subject: campaign.subject,
    text: campaign.text,
    to: ["estimate@example.com"],
  });
  return {
    eligibleCount,
    estimatedCostMicroCents:
      eligibleCount *
      applyManagedUsageMarkup({
        sesCostUsdMicroCents: estimate.sesCostMicroCents,
      }),
    excludedCount: recipients.length - eligibleCount,
    exclusions,
    previewToken,
    totalCount: recipients.length,
    verifiedDomains: domains.map((domain) => domain.domain),
  };
};

export const sendCampaign = async (
  actor: GrowthActor,
  input: z.infer<typeof campaignSendInputSchema>
) => {
  await assertGrowthAccess(actor, "campaigns:send");
  if (!input.confirmed) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Confirm sending this campaign.",
    });
  }
  const requestHash = hashRequest({
    campaignId: input.campaignId,
    expectedUpdatedAt: input.expectedUpdatedAt,
    previewToken: input.previewToken,
  });
  const campaign = await loadCampaign(actor.organizationId, input.campaignId);
  if (
    campaign.sendKey === input.idempotencyKey &&
    campaign.sendRequestHash === requestHash
  ) {
    return serializeCampaign(campaign);
  }
  sendMessageInputSchema.parse({
    from: campaign.from,
    subject: campaign.subject,
    text: campaign.text,
    to: ["validation@example.com"],
  });
  await assertOrganizationOwnsVerifiedSenderDomain({
    organizationId: actor.organizationId,
    sender: campaign.from,
  });
  const entitlement = await getOrganizationBillingEntitlement({
    feature: "organizationMail",
    organizationId: actor.organizationId,
  });
  if (!entitlement.hasAccess) {
    throw new ORPCError("FORBIDDEN", {
      message: "Team mail is not available on this plan.",
    });
  }
  return await db.transaction(async (tx) => {
    await tx
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.id, actor.organizationId))
      .for("update");
    await lockAudienceForSnapshot(
      tx,
      actor.organizationId,
      campaign.audienceId
    );
    const [keyOwner] = await tx
      .select({ id: organizationCampaign.id })
      .from(organizationCampaign)
      .where(
        and(
          eq(organizationCampaign.organizationId, actor.organizationId),
          eq(organizationCampaign.sendKey, input.idempotencyKey)
        )
      )
      .limit(1);
    if (keyOwner !== undefined && keyOwner.id !== input.campaignId) {
      throw new ORPCError("CONFLICT", {
        message: "This confirmation key was already used for another campaign.",
      });
    }
    const [locked] = await tx
      .select()
      .from(organizationCampaign)
      .where(
        and(
          eq(organizationCampaign.id, input.campaignId),
          eq(organizationCampaign.organizationId, actor.organizationId)
        )
      )
      .for("update");
    if (locked === undefined) {
      throw new ORPCError("NOT_FOUND");
    }
    if (
      locked.sendKey === input.idempotencyKey &&
      locked.sendRequestHash === requestHash
    ) {
      return serializeCampaign(locked);
    }
    if (
      locked.status !== "draft" ||
      locked.updatedAt.toISOString() !== input.expectedUpdatedAt ||
      locked.audienceId !== campaign.audienceId
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "This campaign changed. Review the saved draft again before sending.",
      });
    }
    const recipients = await selectAudienceRecipients(tx, {
      audienceId: locked.audienceId,
      organizationId: actor.organizationId,
      segmentIds: locked.segmentIds,
    });
    if (recipients.length > 10_000) {
      throw new ORPCError("BAD_REQUEST", {
        message: "A campaign can include up to 10,000 contacts.",
      });
    }
    if (!recipients.some((recipient) => recipient.eligible)) {
      throw new ORPCError("BAD_REQUEST", {
        message: "No subscribed contacts are eligible for this campaign.",
      });
    }
    const segments =
      locked.segmentIds.length === 0
        ? []
        : await tx
            .select({
              criteria: organizationAudienceSegment.criteria,
              id: organizationAudienceSegment.id,
            })
            .from(organizationAudienceSegment)
            .where(
              and(
                inArray(organizationAudienceSegment.id, locked.segmentIds),
                eq(
                  organizationAudienceSegment.organizationId,
                  actor.organizationId
                )
              )
            )
            .orderBy(asc(organizationAudienceSegment.id));
    if (
      input.previewToken !==
      hashRequest({ campaign: serializeCampaign(locked), recipients, segments })
    ) {
      throw new ORPCError("CONFLICT", {
        message:
          "The audience changed after review. Review the recipients again before sending.",
      });
    }
    const now = new Date();
    for (let offset = 0; offset < recipients.length; offset += 250) {
      await tx.insert(organizationCampaignRecipient).values(
        recipients.slice(offset, offset + 250).map((recipient) => ({
          campaignId: locked.id,
          contactId: recipient.contactId,
          createdAt: now,
          email: recipient.email,
          exclusionReason: recipient.exclusionReason,
          id: randomUUID(),
          membershipId: recipient.membershipId,
          name: recipient.name,
          nextAttemptAt: now,
          organizationId: actor.organizationId,
          sendKey: `campaign:${randomBytes(32).toString("base64url")}`,
          status: recipient.eligible
            ? ("pending" as const)
            : ("excluded" as const),
          subscriptionStatus: recipient.status,
          tags: recipient.tags,
          unsubscribeToken: randomBytes(32).toString("base64url"),
          updatedAt: now,
        }))
      );
    }
    const [updated] = await tx
      .update(organizationCampaign)
      .set({
        selectionSnapshot: {
          audienceId: locked.audienceId,
          criteria: segments.map((segment) => segment.criteria),
          segmentIds: locked.segmentIds,
        },
        sendKey: input.idempotencyKey,
        sendRequestHash: requestHash,
        sentAt: now,
        status: "queued",
        updatedAt: now,
      })
      .where(eq(organizationCampaign.id, locked.id))
      .returning();
    if (updated === undefined) {
      throw new Error("Campaign snapshot failed.");
    }
    return serializeCampaign(updated);
  });
};

export const cancelCampaign = async (
  actor: GrowthActor,
  input: CampaignInput
) => {
  await assertGrowthAccess(actor, "campaigns:send");
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .update(organizationCampaign)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(
        and(
          eq(organizationCampaign.id, input.campaignId),
          eq(organizationCampaign.organizationId, actor.organizationId),
          inArray(organizationCampaign.status, [
            "draft",
            "queued",
            "sending",
            "paused",
          ])
        )
      )
      .returning();
    if (row === undefined) {
      return serializeCampaign(
        await loadCampaign(actor.organizationId, input.campaignId, tx)
      );
    }
    await tx
      .update(organizationCampaignRecipient)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, row.id),
          eq(organizationCampaignRecipient.status, "pending")
        )
      );
    return serializeCampaign(row);
  });
};

export const retryCampaign = async (
  actor: GrowthActor,
  input: CampaignInput
) => {
  await assertGrowthAccess(actor, "campaigns:send");
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(organizationCampaign)
      .where(
        and(
          eq(organizationCampaign.id, input.campaignId),
          eq(organizationCampaign.organizationId, actor.organizationId)
        )
      )
      .for("update");
    if (row === undefined) {
      throw new ORPCError("NOT_FOUND");
    }
    if (row.status !== "paused" && row.status !== "completed") {
      throw new ORPCError("CONFLICT", {
        message: "This campaign cannot be resumed.",
      });
    }
    await tx
      .update(organizationCampaignRecipient)
      .set({
        attempts: 0,
        nextAttemptAt: new Date(),
        status: "pending",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationCampaignRecipient.campaignId, row.id),
          eq(organizationCampaignRecipient.status, "failed")
        )
      );
    const [updated] = await tx
      .update(organizationCampaign)
      .set({ status: "queued", updatedAt: new Date() })
      .where(eq(organizationCampaign.id, row.id))
      .returning();
    if (updated === undefined) {
      throw new Error("Campaign retry failed.");
    }
    return serializeCampaign(updated);
  });
};

export const getCampaign = async (
  actor: GrowthActor,
  input: z.infer<typeof campaignGetInputSchema>
) => {
  await assertGrowthAccess(actor, "campaigns:read");
  const campaign = await loadCampaign(actor.organizationId, input.campaignId);
  const groups = await db
    .select({ count: count(), status: organizationCampaignRecipient.status })
    .from(organizationCampaignRecipient)
    .where(eq(organizationCampaignRecipient.campaignId, campaign.id))
    .groupBy(organizationCampaignRecipient.status);
  const counts = {
    canceled: 0,
    excluded: 0,
    failed: 0,
    pending: 0,
    sending: 0,
    sent: 0,
    uncertain: 0,
  };
  for (const group of groups) {
    counts[group.status] = group.count;
  }
  const recipients = await db
    .select({
      email: organizationCampaignRecipient.email,
      exclusionReason: organizationCampaignRecipient.exclusionReason,
      id: organizationCampaignRecipient.id,
      name: organizationCampaignRecipient.name,
      providerMessageId: organizationCampaignRecipient.providerMessageId,
      status: organizationCampaignRecipient.status,
    })
    .from(organizationCampaignRecipient)
    .where(
      and(
        eq(organizationCampaignRecipient.campaignId, campaign.id),
        input.status === undefined
          ? undefined
          : eq(organizationCampaignRecipient.status, input.status)
      )
    )
    .orderBy(asc(organizationCampaignRecipient.email))
    .offset(input.offset)
    .limit(input.limit);
  const events = await db
    .select({
      eventType: organizationMailDeliveryEvent.eventType,
      occurredAt: organizationMailDeliveryEvent.occurredAt,
      recipient: organizationMailDeliveryEvent.recipient,
    })
    .from(organizationMailDeliveryEvent)
    .innerJoin(
      organizationCampaignRecipient,
      and(
        eq(organizationCampaignRecipient.campaignId, campaign.id),
        eq(
          organizationCampaignRecipient.organizationId,
          organizationMailDeliveryEvent.organizationId
        ),
        eq(
          organizationCampaignRecipient.providerMessageId,
          organizationMailDeliveryEvent.providerMessageId
        ),
        eq(
          organizationCampaignRecipient.email,
          organizationMailDeliveryEvent.recipient
        )
      )
    )
    .orderBy(desc(organizationMailDeliveryEvent.occurredAt))
    .limit(100);
  const deliveryRows = await db
    .select({
      email: organizationCampaignRecipient.email,
      status: organizationMailDeliveryRecipient.status,
    })
    .from(organizationMailDeliveryRecipient)
    .innerJoin(
      organizationCampaignRecipient,
      and(
        eq(organizationCampaignRecipient.campaignId, campaign.id),
        eq(
          organizationCampaignRecipient.organizationId,
          organizationMailDeliveryRecipient.organizationId
        ),
        eq(
          organizationCampaignRecipient.providerMessageId,
          organizationMailDeliveryRecipient.providerMessageId
        ),
        eq(
          organizationCampaignRecipient.email,
          organizationMailDeliveryRecipient.recipient
        )
      )
    );
  const deliveryCounts = {
    bounced: 0,
    complained: 0,
    delivered: 0,
    opened: 0,
    unsubscribed: 0,
  };
  for (const row of deliveryRows) {
    if (
      row.status === "delivered" ||
      row.status === "bounced" ||
      row.status === "complained"
    ) {
      deliveryCounts[row.status] += 1;
    }
  }
  const engagement = await db
    .select({
      count: sql<number>`count(distinct ${organizationMailDeliveryEvent.recipient})::int`,
      eventType: organizationMailDeliveryEvent.eventType,
    })
    .from(organizationMailDeliveryEvent)
    .innerJoin(
      organizationCampaignRecipient,
      and(
        eq(organizationCampaignRecipient.campaignId, campaign.id),
        eq(
          organizationCampaignRecipient.organizationId,
          organizationMailDeliveryEvent.organizationId
        ),
        eq(
          organizationCampaignRecipient.providerMessageId,
          organizationMailDeliveryEvent.providerMessageId
        ),
        eq(
          organizationCampaignRecipient.email,
          organizationMailDeliveryEvent.recipient
        )
      )
    )
    .where(
      inArray(organizationMailDeliveryEvent.eventType, [
        "opened",
        "unsubscribed",
      ])
    )
    .groupBy(organizationMailDeliveryEvent.eventType);
  for (const row of engagement) {
    if (row.eventType === "opened" || row.eventType === "unsubscribed") {
      deliveryCounts[row.eventType] = row.count;
    }
  }
  const totalCount =
    input.status === undefined
      ? Object.values(counts).reduce((total, value) => total + value, 0)
      : counts[input.status];
  return {
    campaign: serializeCampaign(campaign),
    counts,
    deliveryCounts,
    events: events.map((event) => ({
      ...event,
      occurredAt: event.occurredAt.toISOString(),
    })),
    nextOffset:
      input.offset + recipients.length < totalCount
        ? input.offset + recipients.length
        : null,
    recipients: recipients.map((recipient) => ({
      ...recipient,
      deliveryStatus:
        deliveryRows.find((row) => row.email === recipient.email)?.status ??
        null,
    })),
    totalCount,
  };
};

export const unsubscribeCampaignRecipient = async (
  token: string
): Promise<void> => {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
    throw new ORPCError("NOT_FOUND");
  }
  const [row] = await db
    .select({
      audienceId: organizationCampaign.audienceId,
      email: organizationCampaignRecipient.email,
      id: organizationCampaignRecipient.id,
      membershipId: organizationCampaignRecipient.membershipId,
      organizationId: organizationCampaignRecipient.organizationId,
      providerMessageId: organizationCampaignRecipient.providerMessageId,
    })
    .from(organizationCampaignRecipient)
    .innerJoin(
      organizationCampaign,
      eq(organizationCampaign.id, organizationCampaignRecipient.campaignId)
    )
    .where(eq(organizationCampaignRecipient.unsubscribeToken, token))
    .limit(1);
  if (row === undefined) {
    throw new ORPCError("NOT_FOUND");
  }
  await unsubscribeAudienceMembership({
    audienceId: row.audienceId,
    idempotencyKey: `campaign-unsubscribe:${row.id}`,
    membershipId: row.membershipId,
    organizationId: row.organizationId,
    source: "campaign",
  });
  if (row.providerMessageId !== null) {
    const now = new Date();
    await db
      .insert(organizationMailDeliveryEvent)
      .values({
        createdAt: now,
        dedupeKey: `campaign-unsubscribe:${row.id}`,
        eventType: "unsubscribed",
        id: randomUUID(),
        occurredAt: now,
        organizationId: row.organizationId,
        provider: "quieter",
        providerMessageId: row.providerMessageId,
        recipient: row.email,
      })
      .onConflictDoNothing();
  }
};
