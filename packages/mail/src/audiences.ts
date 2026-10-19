import { z } from "zod";

const idSchema = z.string().trim().min(1).max(200);
const organizationInputSchema = z.object({ organizationId: idSchema });
const audienceInputSchema = organizationInputSchema.extend({
  audienceId: idSchema,
});
const membershipInputSchema = audienceInputSchema.extend({
  membershipId: idSchema,
});
const idempotencyKeySchema = z.string().trim().min(1).max(200);
const tagsSchema = z.array(z.string().trim().min(1).max(80)).max(50);
const pageSchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});
const channelSchema = z
  .enum(["manual", "api", "import", "campaign"])
  .default("manual");

export const audienceMembershipStatusSchema = z.enum([
  "subscribed",
  "unsubscribed",
  "removed",
]);
export const audienceSegmentCriteriaSchema = z.object({
  allTags: tagsSchema.default([]),
  anyTags: tagsSchema.default([]),
  excludeTags: tagsSchema.default([]),
});
export const audienceContactRowSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  name: z.string().trim().max(200).nullable().optional(),
  tags: tagsSchema.default([]),
});
export const audienceListInputSchema = organizationInputSchema.extend({
  search: z.string().trim().max(200).optional(),
  ...pageSchema.shape,
});
export const audienceGetInputSchema = audienceInputSchema;
export const audienceCreateInputSchema = organizationInputSchema.extend({
  description: z.string().trim().max(1000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
  name: z.string().trim().min(1).max(100),
});
export const audienceUpdateInputSchema = audienceInputSchema.extend({
  description: z.string().trim().max(1000).nullable().optional(),
  name: z.string().trim().min(1).max(100).optional(),
});
export const audienceListContactsInputSchema = audienceInputSchema.extend({
  search: z.string().trim().max(200).optional(),
  segmentId: idSchema.optional(),
  status: audienceMembershipStatusSchema.optional(),
  suppression: z.enum(["all", "suppressed", "clear"]).default("all"),
  tag: z.string().trim().max(80).optional(),
  ...pageSchema.shape,
});
export const audienceRegisterContactInputSchema = audienceInputSchema.extend({
  ...audienceContactRowSchema.shape,
  channel: channelSchema,
  consentSource: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
  occurredAt: z.iso.datetime().optional(),
});
export const audienceImportContactsInputSchema = audienceInputSchema.extend({
  consentSource: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
  occurredAt: z.iso.datetime().optional(),
  rows: z.array(z.unknown()).min(1).max(500),
});
export const audienceUpdateContactInputSchema = membershipInputSchema.extend({
  name: z.string().trim().max(200).nullable().optional(),
  tags: tagsSchema.optional(),
});
export const audienceUnsubscribeContactInputSchema =
  membershipInputSchema.extend({
    channel: channelSchema,
    idempotencyKey: idempotencyKeySchema,
    occurredAt: z.iso.datetime().optional(),
    reason: z.string().trim().max(500).optional(),
    source: z.string().trim().max(500).optional(),
  });
export const audienceRemoveContactInputSchema =
  audienceUnsubscribeContactInputSchema;
export const audienceResubscribeContactInputSchema =
  membershipInputSchema.extend({
    channel: channelSchema,
    consentConfirmed: z.literal(true),
    consentSource: z.string().trim().min(1).max(500),
    idempotencyKey: idempotencyKeySchema,
    occurredAt: z.iso.datetime(),
  });
export const audienceSetSuppressionInputSchema = membershipInputSchema.extend({
  idempotencyKey: idempotencyKeySchema,
  reason: z.string().trim().max(500).optional(),
  suppressed: z.boolean(),
});
export const audienceListHistoryInputSchema = audienceInputSchema.extend({
  membershipId: idSchema.optional(),
  ...pageSchema.shape,
});
export const audienceListSegmentsInputSchema = audienceInputSchema;
export const audienceCreateSegmentInputSchema = audienceInputSchema.extend({
  criteria: audienceSegmentCriteriaSchema,
  name: z.string().trim().min(1).max(100),
});
export const audienceUpdateSegmentInputSchema = audienceInputSchema.extend({
  criteria: audienceSegmentCriteriaSchema.optional(),
  name: z.string().trim().min(1).max(100).optional(),
  segmentId: idSchema,
});
export const audienceDeleteSegmentInputSchema = audienceInputSchema.extend({
  segmentId: idSchema,
});

export const audienceSchema = z.object({
  contactCount: z.number(),
  createdAt: z.iso.datetime(),
  description: z.string().nullable(),
  id: z.string(),
  name: z.string(),
  subscribedCount: z.number(),
  updatedAt: z.iso.datetime(),
});
export const audienceContactSchema = z.object({
  consentOccurredAt: z.iso.datetime(),
  consentSource: z.string(),
  contactId: z.string(),
  createdAt: z.iso.datetime(),
  email: z.string(),
  id: z.string(),
  lastLifecycleOccurredAt: z.iso.datetime(),
  name: z.string().nullable(),
  status: audienceMembershipStatusSchema,
  suppression: z
    .object({
      createdAt: z.iso.datetime(),
      reason: z.enum(["bounce", "complaint", "manual", "unsubscribe"]),
    })
    .nullable(),
  tags: z.array(z.string()),
  updatedAt: z.iso.datetime(),
});
export const audienceSegmentSchema = z.object({
  createdAt: z.iso.datetime(),
  criteria: audienceSegmentCriteriaSchema,
  id: z.string(),
  name: z.string(),
  updatedAt: z.iso.datetime(),
});
export const audienceHistoryEventSchema = z.object({
  actorId: z.string().nullable(),
  actorType: z.enum(["user", "api_key", "recipient"]),
  afterStatus: audienceMembershipStatusSchema,
  applied: z.boolean(),
  beforeStatus: audienceMembershipStatusSchema.nullable(),
  channel: z.string(),
  contactId: z.string(),
  eventType: z.string(),
  id: z.string(),
  membershipId: z.string(),
  occurredAt: z.iso.datetime(),
  reason: z.string().nullable(),
  recordedAt: z.iso.datetime(),
  source: z.string(),
});
export const audienceListResultSchema = z.object({
  items: z.array(audienceSchema),
  nextCursor: z.string().nullable(),
});
export const audienceListContactsResultSchema = z.object({
  items: z.array(audienceContactSchema),
  nextCursor: z.string().nullable(),
});
export const audienceListHistoryResultSchema = z.object({
  items: z.array(audienceHistoryEventSchema),
  nextCursor: z.string().nullable(),
});
export const audienceListSegmentsResultSchema = z.array(audienceSegmentSchema);
export const audienceDeleteSegmentResultSchema = z.object({
  success: z.literal(true),
});
export const audienceImportResultSchema = z.object({
  created: z.number(),
  duplicate: z.number(),
  inactive: z.number(),
  invalid: z.number(),
  rows: z.array(
    z.object({
      email: z.string().optional(),
      membershipId: z.string().optional(),
      message: z.string().optional(),
      row: z.number(),
      status: z.enum([
        "created",
        "updated",
        "unchanged",
        "inactive",
        "duplicate",
        "invalid",
      ]),
    })
  ),
  unchanged: z.number(),
  updated: z.number(),
});

export type AudienceMembershipStatus = z.infer<
  typeof audienceMembershipStatusSchema
>;
export type AudienceSegmentCriteria = z.infer<
  typeof audienceSegmentCriteriaSchema
>;
export type Audience = z.infer<typeof audienceSchema>;
export type AudienceContact = z.infer<typeof audienceContactSchema>;
export type AudienceImportResult = z.infer<typeof audienceImportResultSchema>;
