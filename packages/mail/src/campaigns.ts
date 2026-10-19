import { z } from "zod";

const organizationInput = z.object({ organizationId: z.string().min(1) });
const campaignInput = organizationInput.extend({
  campaignId: z.string().min(1),
});
const draftFields = {
  audienceId: z.string().min(1),
  from: z.string().trim().max(320),
  name: z.string().trim().min(1).max(200),
  segmentIds: z.array(z.string().min(1)).max(25).default([]),
  subject: z.string().trim().max(998),
  text: z.string().max(100_000),
};
export const campaignStatusSchema = z.enum([
  "draft",
  "queued",
  "sending",
  "completed",
  "canceled",
  "paused",
]);
export const campaignRecipientStatusSchema = z.enum([
  "pending",
  "sending",
  "sent",
  "uncertain",
  "failed",
  "excluded",
  "canceled",
]);
export const campaignCreateInputSchema = organizationInput.extend(draftFields);
export const campaignUpdateInputSchema = campaignInput.extend({
  ...draftFields,
  expectedUpdatedAt: z.iso.datetime(),
});
export const campaignListInputSchema = organizationInput.extend({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
});
export const campaignGetInputSchema = campaignInput.extend({
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
  status: campaignRecipientStatusSchema.optional(),
});
export const campaignPreviewInputSchema = campaignInput;
export const campaignCancelInputSchema = campaignInput;
export const campaignRetryInputSchema = campaignInput;
export const campaignSendInputSchema = campaignInput.extend({
  confirmed: z.literal(true),
  expectedUpdatedAt: z.iso.datetime(),
  idempotencyKey: z.string().trim().min(1).max(200),
  previewToken: z.string().regex(/^[a-f\d]{64}$/u),
});
export const campaignSchema = z.object({
  ...draftFields,
  createdAt: z.iso.datetime(),
  id: z.string(),
  organizationId: z.string(),
  segmentIds: z.array(z.string()),
  sentAt: z.iso.datetime().nullable(),
  status: campaignStatusSchema,
  updatedAt: z.iso.datetime(),
});
export const campaignListResultSchema = z.object({
  campaigns: z.array(campaignSchema),
  nextOffset: z.number().nullable(),
  totalCount: z.number(),
});
export const campaignPreviewResultSchema = z.object({
  eligibleCount: z.number(),
  estimatedCostMicroCents: z.number(),
  excludedCount: z.number(),
  exclusions: z.record(z.string(), z.number()),
  previewToken: z.string(),
  totalCount: z.number(),
  verifiedDomains: z.array(z.string()),
});
export const campaignDetailResultSchema = z.object({
  campaign: campaignSchema,
  counts: z.object({
    canceled: z.number(),
    excluded: z.number(),
    failed: z.number(),
    pending: z.number(),
    sending: z.number(),
    sent: z.number(),
    uncertain: z.number(),
  }),
  deliveryCounts: z.object({
    bounced: z.number(),
    complained: z.number(),
    delivered: z.number(),
    opened: z.number(),
    unsubscribed: z.number(),
  }),
  events: z.array(
    z.object({
      eventType: z.string(),
      occurredAt: z.iso.datetime(),
      recipient: z.string(),
    })
  ),
  nextOffset: z.number().nullable(),
  recipients: z.array(
    z.object({
      deliveryStatus: z.string().nullable(),
      email: z.string(),
      exclusionReason: z.string().nullable(),
      id: z.string(),
      name: z.string().nullable(),
      providerMessageId: z.string().nullable(),
      status: campaignRecipientStatusSchema,
    })
  ),
  totalCount: z.number(),
});
export type Campaign = z.infer<typeof campaignSchema>;
