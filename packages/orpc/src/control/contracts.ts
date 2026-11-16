import {
  calendarAccountBaseSchema,
  calendarEventRefSchema,
  calendarEventSchema,
  calendarEventsInputSchema,
  calendarRefSchema,
  calendarSummarySchema,
} from "@quieter/calendar";
import { composeDraftAnchorSchema } from "@quieter/mail/compose/schema";
import { mailCategorySchema } from "@quieter/mail/data-plane";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";
import type { MessageListItem } from "@quieter/mail/messages";
import { z } from "zod";

import { mailInputSchemas } from "../mail/inputs";
import {
  controlMutationRequirements,
  controlOperationIdSchema,
  controlScopeSchema,
  controlTargetSchema,
} from "./registry";
import type { ControlOperationId } from "./registry";

export { controlTargetSchema as controlDiscoveryInputSchema } from "./registry";

const identifierSchema = z.string().trim().min(1);
const instantSchema = z.iso.datetime({ offset: true });
const mailboxInputSchema = z.strictObject({
  mailboxId: identifierSchema,
  organizationId: identifierSchema,
});

export const controlErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "BAD_REQUEST",
      "UNAUTHORIZED",
      "FORBIDDEN",
      "NOT_FOUND",
      "CONFLICT",
      "RATE_LIMITED",
      "REAUTHENTICATION_REQUIRED",
      "CANCELLED",
      "UNSUPPORTED_OPERATION",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
    requestId: identifierSchema.optional(),
    retryAfterMs: z.number().int().nonnegative().optional(),
  }),
});

export const controlMailSourceSchema = z.object({
  href: z.string().startsWith("/?"),
  mailboxId: identifierSchema,
  messageId: identifierSchema,
  threadId: identifierSchema,
});

const attachmentSchema = z.object({
  attachmentId: identifierSchema,
  fileName: z.string(),
  mimeType: z.string(),
  size: z.number().int().nonnegative(),
});

export const controlMailMessageSchema = z.object({
  attachments: z.array(attachmentSchema).optional(),
  baseRevision: z.string().optional(),
  bcc: z.string().optional(),
  bodyHtml: z.string().optional(),
  bodyText: z.string().optional(),
  cc: z.string().optional(),
  date: z.string().optional(),
  draftAnchor: composeDraftAnchorSchema.optional(),
  draftId: z.string().optional(),
  from: z.string().optional(),
  id: identifierSchema,
  inReplyTo: z.string().optional(),
  inlineImages: z
    .array(attachmentSchema.extend({ contentId: z.string() }))
    .optional(),
  internalDate: z.string().optional(),
  isImportant: z.boolean().optional(),
  isUnread: z.boolean().optional(),
  labelIds: z.array(z.string()).optional(),
  messageHeaderId: z.string().optional(),
  receivedAt: z.string().optional(),
  references: z.string().optional(),
  replyTo: z.string().optional(),
  senderAvatarUrls: z
    .object({ dark: z.string(), light: z.string() })
    .optional(),
  snippet: z.string().optional(),
  source: controlMailSourceSchema,
  subject: z.string().optional(),
  threadAttachmentCount: z.number().int().nonnegative().optional(),
  threadAttachmentNames: z.array(z.string()).optional(),
  threadId: identifierSchema,
  threadIsImportant: z.boolean().optional(),
  threadLabelIds: z.array(z.string()).optional(),
  threadMessageCount: z.number().int().nonnegative().optional(),
  to: z.string().optional(),
  unsubscribeMailto: z.string().optional(),
  unsubscribeStatus: z.enum(["requested", "confirming"]).optional(),
  unsubscribeUrl: z.string().optional(),
});

export type ControlMailMessage = z.infer<typeof controlMailMessageSchema>;

export const toControlMailMessage = (input: {
  mailboxId: string;
  message: MessageListItem;
}): ControlMailMessage => {
  const search = new URLSearchParams({
    mailboxId: input.mailboxId,
    messageId: input.message.id,
    threadId: input.message.threadId,
  });
  return controlMailMessageSchema.parse({
    ...input.message,
    source: {
      href: `/?${search.toString()}`,
      mailboxId: input.mailboxId,
      messageId: input.message.id,
      threadId: input.message.threadId,
    },
  });
};

const mailboxCapabilitiesSchema = z.object({
  canDeletePermanently: z.boolean(),
  canManageKnowledge: z.boolean(),
  canManageLabels: z.boolean(),
  canMarkRead: z.boolean(),
  canMoveToInbox: z.boolean(),
  canMoveToSpam: z.boolean(),
  canMoveToTrash: z.boolean(),
  canSend: z.boolean(),
  canSetImportance: z.boolean(),
  canSetSenderName: z.boolean(),
  categories: z.array(mailCategorySchema),
}) satisfies z.ZodType<MailboxCapabilities>;

const mailboxSchema = z.object({
  accessMode: z.enum(["private", "shared"]).nullable(),
  autoLabelEnabled: z.boolean(),
  capabilities: mailboxCapabilitiesSchema,
  connectionStatus: z.enum(["connected", "needs_reconnect"]),
  directGrantRole: z.enum(["manager", "reader", "responder"]).nullable(),
  displayName: z.string().nullable(),
  divisionGrantRoles: z.array(
    z.object({
      divisionId: identifierSchema,
      divisionName: z.string(),
      role: z.enum(["manager", "reader", "responder"]),
    })
  ),
  divisionId: identifierSchema.nullable(),
  divisionName: z.string().nullable(),
  emailAddress: z.string(),
  grantRole: z.enum(["manager", "reader", "responder"]).nullable(),
  groupId: identifierSchema,
  groupKind: z.enum(["division", "organization", "unassigned"]),
  groupName: z.string(),
  id: identifierSchema,
  includeApiSentMessages: z.boolean(),
  organizationId: identifierSchema,
  signatureHtml: z.string().nullable().optional(),
  signatureText: z.string().nullable().optional(),
  unreadNonSpamCount: z.number().int().nonnegative(),
  usefulDetailsEnabled: z.boolean(),
});

const calendarAccountSchema = calendarAccountBaseSchema.extend({
  mailboxId: identifierSchema.nullable(),
  status: z.enum([
    "connected",
    "needs-permission",
    "needs-reconnect",
    "needs-mailbox",
  ]),
});

const receiptBase = z.object({
  createdAt: instantSchema,
  operationId: identifierSchema,
});
const pendingReceiptSchema = receiptBase.extend({
  retryAfterMs: z.number().int().nonnegative().optional(),
  state: z.literal("pending"),
});
const uncertainReceiptSchema = receiptBase.extend({
  state: z.literal("uncertain"),
});
const succeededReceiptSchema = receiptBase.extend({
  completedAt: instantSchema,
  state: z.literal("succeeded"),
});
const failedReceiptSchema = receiptBase.extend({
  completedAt: instantSchema,
  error: controlErrorSchema.shape.error,
  state: z.literal("failed"),
});
const cancelledReceiptSchema = receiptBase.extend({
  completedAt: instantSchema,
  state: z.literal("cancelled"),
});

export const controlOperationReceiptSchema = z.discriminatedUnion("state", [
  pendingReceiptSchema,
  uncertainReceiptSchema,
  succeededReceiptSchema,
  failedReceiptSchema,
  cancelledReceiptSchema,
]);

const mutationResultSchema = <Result extends z.ZodType>(result: Result) =>
  z.discriminatedUnion("state", [
    pendingReceiptSchema,
    uncertainReceiptSchema,
    succeededReceiptSchema.extend({ result }),
    failedReceiptSchema,
    cancelledReceiptSchema,
  ]);

const mutationInput = {
  approvalId: identifierSchema,
  idempotencyKey: z.string().trim().min(1).max(255),
};

export const controlDiscoveryOutputSchema = z.object({
  operations: z.array(
    z.object({
      effect: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("read") }),
        z.object({
          audit: z.literal(controlMutationRequirements.audit),
          confirmation: z.literal(controlMutationRequirements.confirmation),
          idempotency: z.literal(controlMutationRequirements.idempotency),
          kind: z.literal("mutation"),
        }),
      ]),
      id: controlOperationIdSchema,
      scope: controlScopeSchema,
      target: z.enum(
        controlTargetSchema.options.map((target) => target.shape.kind.value)
      ),
    })
  ),
});

export const controlContracts = {
  "automation.read": {
    input: mailboxInputSchema,
    output: z.object({
      canRun: z.boolean(),
      canSaveDraft: z.boolean(),
      enabled: z.boolean(),
      shared: z.boolean(),
      version: z.number().int().nonnegative(),
    }),
  },
  "calendar.accounts": {
    input: z.strictObject({}),
    output: z.object({ accounts: z.array(calendarAccountSchema) }),
  },
  "calendar.event": {
    input: calendarEventRefSchema,
    output: calendarEventSchema,
  },
  "calendar.events": {
    input: calendarEventsInputSchema,
    output: z.object({ events: z.array(calendarEventSchema) }),
  },
  "calendar.list": {
    input: calendarRefSchema.pick({ connectionId: true }),
    output: z.object({ calendars: z.array(calendarSummarySchema) }),
  },
  "mail.read_thread": {
    input: mailInputSchemas.getThread
      .extend({ organizationId: identifierSchema, threadId: identifierSchema })
      .strict(),
    output: z.object({
      messages: z.array(controlMailMessageSchema),
      snippet: z.string().optional(),
      subject: z.string().optional(),
      threadId: identifierSchema,
    }),
  },
  "mail.search": {
    input: mailInputSchemas.listThreads
      .extend({ organizationId: identifierSchema })
      .strict(),
    output: z.object({
      historyId: z.string().optional(),
      messages: z.array(controlMailMessageSchema),
      nextPageToken: z.string().optional(),
      resultSizeEstimate: z.number().int().nonnegative().optional(),
    }),
  },
  "mail.set_read": {
    input: mailboxInputSchema.extend({
      ...mutationInput,
      read: z.boolean(),
      threadId: identifierSchema,
    }),
    output: mutationResultSchema(
      z.object({ read: z.boolean(), threadId: identifierSchema })
    ),
  },
  "mailboxes.list": {
    input: z.strictObject({}),
    output: z.object({
      defaultMailboxId: identifierSchema.nullable(),
      groups: z.array(
        z.object({
          id: identifierSchema,
          kind: z.enum(["division", "organization", "unassigned"]),
          mailboxes: z.array(mailboxSchema),
          name: z.string(),
          organizationId: identifierSchema,
          slug: z.string().nullable(),
        })
      ),
    }),
  },
  "organization.read": {
    input: z.strictObject({ organizationId: identifierSchema }),
    output: z.object({
      canManageSettings: z.boolean(),
      organizationId: identifierSchema,
    }),
  },
  "organization.settings.update": {
    input: z
      .strictObject({
        ...mutationInput,
        allowPerSendOverride: z.boolean().optional(),
        openTrackingEnabled: z.boolean().optional(),
        organizationId: identifierSchema,
      })
      .refine(
        (value) =>
          value.allowPerSendOverride !== undefined ||
          value.openTrackingEnabled !== undefined,
        "Provide a settings change."
      ),
    output: mutationResultSchema(
      z.object({
        allowPerSendOverride: z.boolean(),
        openTrackingEnabled: z.boolean(),
      })
    ),
  },
  "settings.read": {
    input: z.strictObject({}),
    output: z.object({
      timeFormat: z.enum(["12h", "24h"]),
      weekStartsOn: z.union([
        z.literal(0),
        z.literal(1),
        z.literal(2),
        z.literal(3),
        z.literal(4),
        z.literal(5),
        z.literal(6),
      ]),
    }),
  },
} satisfies Record<ControlOperationId, { input: z.ZodType; output: z.ZodType }>;

export type ControlRequest<Operation extends ControlOperationId> = z.input<
  (typeof controlContracts)[Operation]["input"]
>;
export type ControlResult<Operation extends ControlOperationId> = z.output<
  (typeof controlContracts)[Operation]["output"]
>;
