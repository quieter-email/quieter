import { z } from "zod";

import * as audiences from "./audiences";
import * as campaigns from "./campaigns";
import * as templates from "./templates";

export const controlOperations = {
  "audiences.create": {
    description: "Create an audience with an idempotency key.",
    input: audiences.audienceCreateInputSchema.omit({ organizationId: true }),
    output: audiences.audienceSchema,
    scope: "audiences:write",
  },
  "audiences.createSegment": {
    description:
      "Create an audience segment using required, optional and excluded tags.",
    input: audiences.audienceCreateSegmentInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceSegmentSchema,
    scope: "audiences:write",
  },
  "audiences.deleteSegment": {
    description:
      "Delete a segment without deleting contacts or campaign history.",
    input: audiences.audienceDeleteSegmentInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceDeleteSegmentResultSchema,
    scope: "audiences:write",
  },
  "audiences.get": {
    description: "Read an audience and its membership counts.",
    input: audiences.audienceGetInputSchema.omit({ organizationId: true }),
    output: audiences.audienceSchema,
    scope: "audiences:read",
  },
  "audiences.importContacts": {
    description:
      "Import up to 500 contacts with row-level validation and idempotent results.",
    input: audiences.audienceImportContactsInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceImportResultSchema,
    scope: "audiences:write",
  },
  "audiences.list": {
    description: "List the team's audiences.",
    input: audiences.audienceListInputSchema.omit({ organizationId: true }),
    output: audiences.audienceListResultSchema,
    scope: "audiences:read",
  },
  "audiences.listContacts": {
    description:
      "Search and filter audience members, including subscription and safety suppression states.",
    input: audiences.audienceListContactsInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceListContactsResultSchema,
    scope: "audiences:read",
  },
  "audiences.listHistory": {
    description: "Read append-only audience or contact lifecycle history.",
    input: audiences.audienceListHistoryInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceListHistoryResultSchema,
    scope: "audiences:read",
  },
  "audiences.listSegments": {
    description: "List deterministic tag-based audience segments.",
    input: audiences.audienceListSegmentsInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceListSegmentsResultSchema,
    scope: "audiences:read",
  },
  "audiences.registerContact": {
    description:
      "Register a consenting contact. Existing inactive subscriptions are never restored by registration.",
    input: audiences.audienceRegisterContactInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.removeContact": {
    description:
      "Remove audience membership while preserving subscription history.",
    input: audiences.audienceRemoveContactInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.resubscribeContact": {
    description:
      "Record explicit fresh consent to restore membership. Does not clear safety suppression.",
    input: audiences.audienceResubscribeContactInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.setSuppression": {
    description:
      "Explicitly change organization safety suppression with an audit record.",
    input: audiences.audienceSetSuppressionInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.unsubscribeContact": {
    description:
      "Unsubscribe a contact from this audience and append the lifecycle event.",
    input: audiences.audienceUnsubscribeContactInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.update": {
    description: "Update an audience name or description.",
    input: audiences.audienceUpdateInputSchema.omit({ organizationId: true }),
    output: audiences.audienceSchema,
    scope: "audiences:write",
  },
  "audiences.updateContact": {
    description:
      "Update a contact name and audience tags without changing consent.",
    input: audiences.audienceUpdateContactInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceContactSchema,
    scope: "audiences:write",
  },
  "audiences.updateSegment": {
    description:
      "Update a segment without rewriting existing campaign snapshots.",
    input: audiences.audienceUpdateSegmentInputSchema.omit({
      organizationId: true,
    }),
    output: audiences.audienceSegmentSchema,
    scope: "audiences:write",
  },
  "campaigns.cancel": {
    description:
      "Cancel unsent campaign recipients while preserving delivery history.",
    input: campaigns.campaignCancelInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignSchema,
    scope: "campaigns:send",
  },
  "campaigns.create": {
    description: "Save a campaign draft without sending.",
    input: campaigns.campaignCreateInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignSchema,
    scope: "campaigns:write",
  },
  "campaigns.get": {
    description:
      "Read campaign progress, delivery events and recipient results.",
    input: campaigns.campaignGetInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignDetailResultSchema,
    scope: "campaigns:read",
  },
  "campaigns.list": {
    description: "List saved drafts and broadcast campaigns.",
    input: campaigns.campaignListInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignListResultSchema,
    scope: "campaigns:read",
  },
  "campaigns.preview": {
    description:
      "Preview eligible and excluded recipients, verified domains and estimated cost.",
    input: campaigns.campaignPreviewInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignPreviewResultSchema,
    scope: "campaigns:read",
  },
  "campaigns.retry": {
    description:
      "Resume safe retryable recipients. Accepted and uncertain sends are never restarted.",
    input: campaigns.campaignRetryInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignSchema,
    scope: "campaigns:send",
  },
  "campaigns.send": {
    description:
      "Freeze recipients and queue a broadcast. Requires explicit confirmed:true, the reviewed draft version, and an idempotency key. Obtain user approval of the reviewed recipient counts and content before calling.",
    input: campaigns.campaignSendInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignSchema,
    scope: "campaigns:send",
  },
  "campaigns.update": {
    description: "Update an unsent draft.",
    input: campaigns.campaignUpdateInputSchema.omit({ organizationId: true }),
    output: campaigns.campaignSchema,
    scope: "campaigns:write",
  },
  "templates.archive": {
    description: "Archive or restore a saved email template.",
    input: templates.templateArchiveInputSchema.omit({ organizationId: true }),
    output: templates.emailTemplateSchema,
    scope: "templates:write",
  },
  "templates.create": {
    description:
      "Save a reusable text, visual, or imported HTML email template.",
    input: templates.templateCreateInputSchema.omit({ organizationId: true }),
    output: templates.emailTemplateSchema,
    scope: "templates:write",
  },
  "templates.duplicate": {
    description: "Copy a template into a separate editable template.",
    input: templates.templateDuplicateInputSchema.omit({
      organizationId: true,
    }),
    output: templates.emailTemplateSchema,
    scope: "templates:write",
  },
  "templates.get": {
    description: "Read a saved email template and its editable content.",
    input: templates.templateGetInputSchema.omit({ organizationId: true }),
    output: templates.emailTemplateSchema,
    scope: "templates:read",
  },
  "templates.list": {
    description: "List saved email templates for the authenticated team.",
    input: templates.templateListInputSchema.omit({ organizationId: true }),
    output: templates.templateListResultSchema,
    scope: "templates:read",
  },
  "templates.render": {
    description:
      "Export a saved template as HTML and text, plus React Email source and editable JSON for visual designs.",
    input: templates.templateRenderInputSchema.omit({ organizationId: true }),
    output: templates.templateRenderResultSchema,
    scope: "templates:read",
  },
  "templates.update": {
    description: "Update a template using its current saved version.",
    input: templates.templateUpdateInputSchema.omit({ organizationId: true }),
    output: templates.emailTemplateSchema,
    scope: "templates:write",
  },
} as const;

export type ControlOperation = keyof typeof controlOperations;
export type ControlInput<K extends ControlOperation> = z.input<
  (typeof controlOperations)[K]["input"]
>;
export type ControlOutput<K extends ControlOperation> = z.output<
  (typeof controlOperations)[K]["output"]
>;

export const controlOperationSchema = z.custom<ControlOperation>(
  (value) =>
    typeof value === "string" && Object.hasOwn(controlOperations, value)
);

export const controlRequestSchema = z.object({
  input: z.unknown(),
  operation: controlOperationSchema,
});
