import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

export const assistantPolicySchema = z.enum(["ask", "automatic"]);

export const assistantCapabilitySchema = z.enum([
  "navigate",
  "compose",
  "edit_compose",
  "save_draft",
  "send_mail",
  "modify_mail",
]);

export const workspaceViewSchema = z.enum([
  "inbox",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
  "drafts",
  "template",
  "labels",
  "compose",
]);
export const navigableWorkspaceViewSchema = workspaceViewSchema.exclude([
  "compose",
]);

const optionalText = z.string().trim().max(10_000).optional();
const optionalIdentifier = z.string().trim().min(1).max(256).optional();

const foregroundComposeAssetSchema = z
  .object({
    gmailAttachmentId: optionalIdentifier,
    id: z.string().trim().min(1).max(256),
    mimeType: z.string().trim().min(1).max(998),
    name: z.string().trim().min(1).max(998),
    size: z
      .number()
      .int()
      .nonnegative()
      .max(24 * 1024 * 1024),
  })
  .strict();

const foregroundComposeAttachmentSchema = foregroundComposeAssetSchema
  .extend({ isInline: z.literal(false) })
  .strict();

const foregroundComposeInlineImageSchema = foregroundComposeAssetSchema
  .extend({
    contentId: z.string().trim().min(1).max(998),
    isInline: z.literal(true),
  })
  .strict();

export const foregroundSnapshotSchema = z
  .object({
    capabilities: z.array(assistantCapabilitySchema).max(6),
    draftId: optionalIdentifier,
    draftRevision: z.number().int().nonnegative().optional(),
    exchangeId: z.uuid(),
    expiresAt: z.number().int().positive(),
    generation: z.number().int().positive(),
    policy: assistantPolicySchema,
    query: z.string().trim().max(500).optional(),
    selectedMessageId: optionalIdentifier,
    selectedThreadId: optionalIdentifier,
    tabId: z.string().trim().min(1).max(128),
    view: workspaceViewSchema.optional(),
  })
  .strict();

export type ForegroundSnapshot = z.infer<typeof foregroundSnapshotSchema>;

export const foregroundComposeDraftSchema = z
  .object({
    attachments: z.array(foregroundComposeAttachmentSchema).max(100),
    bcc: optionalText,
    bodyHtml: z.string().max(100_000),
    bodyText: optionalText,
    cc: optionalText,
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    inlineImages: z.array(foregroundComposeInlineImageSchema).max(100),
    providerDraftId: z.string().trim().min(1).max(256).optional(),
    replyContext: z
      .object({
        messageHeaderId: z.string().trim().min(1).max(998).optional(),
        references: z.array(z.string().trim().min(1).max(998)).max(100),
        threadId: z.string().trim().min(1).max(256),
      })
      .strict()
      .nullable()
      .optional(),
    subject: optionalText,
    to: optionalText,
  })
  .strict();

const workspaceResultSchema = z
  .object({
    draft: foregroundComposeDraftSchema.optional(),
    draftId: optionalIdentifier,
    draftRevision: z.number().int().nonnegative().optional(),
    generation: z.number().int().positive(),
    mailboxId: z.string().trim().min(1).max(128),
    query: z.string().trim().max(500).optional(),
    selectedMessageId: optionalIdentifier,
    selectedThreadId: optionalIdentifier,
    view: workspaceViewSchema.optional(),
  })
  .strict();

export const getWorkspaceInputSchema = z.object({}).strict();
export const getWorkspaceOutputSchema = workspaceResultSchema;

export const navigateInputSchema = z
  .object({
    messageId: optionalIdentifier,
    query: z.string().trim().max(500).optional(),
    threadId: optionalIdentifier,
    view: navigableWorkspaceViewSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.messageId !== undefined ||
      input.query !== undefined ||
      input.threadId !== undefined ||
      input.view !== undefined,
    "Provide a workspace destination."
  );
export const navigateOutputSchema = workspaceResultSchema;

const composeFieldsSchema = foregroundComposeDraftSchema.pick({
  bcc: true,
  bodyText: true,
  cc: true,
  subject: true,
  to: true,
});

export const openComposeInputSchema = composeFieldsSchema;
export const openComposeOutputSchema = z
  .object({
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    generation: z.number().int().positive(),
  })
  .strict();

export const editComposeInputSchema = composeFieldsSchema
  .extend({
    draftId: z.string().trim().min(1).max(256),
    expectedDraftRevision: z.number().int().nonnegative(),
  })
  .strict();
export const editComposeOutputSchema = openComposeOutputSchema;

export const saveComposeDraftInputSchema = z
  .object({ draft: foregroundComposeDraftSchema })
  .strict();
export const saveComposeDraftOutputSchema = z
  .object({
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    messageId: z.string().trim().min(1).max(256).optional(),
    providerDraftId: z.string().trim().min(1).max(256),
    status: z.literal("draft_saved"),
  })
  .strict();

export const sendMailInputSchema = z
  .object({ draft: foregroundComposeDraftSchema })
  .strict();
export const sendMailOutputSchema = z
  .object({
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    id: z.string().trim().min(1).max(256),
    status: z.literal("sent"),
    threadId: z.string().trim().min(1).max(256).optional(),
  })
  .strict();

export type ForegroundServerToolsContext = {
  saveComposeDraft: (
    input: {
      draft: z.infer<typeof foregroundComposeDraftSchema>;
      toolCallId: string;
    },
    signal?: AbortSignal
  ) => Promise<z.infer<typeof saveComposeDraftOutputSchema>>;
  sendMail: (
    input: {
      draft: z.infer<typeof foregroundComposeDraftSchema>;
      toolCallId: string;
    },
    signal?: AbortSignal
  ) => Promise<z.infer<typeof sendMailOutputSchema>>;
};

export const foregroundToolRegistry = {
  edit_compose: {
    capability: "edit_compose",
    label: "Edit draft",
    location: "client",
    risk: "workspace" as const,
  },
  get_workspace: {
    capability: "navigate",
    label: "Read workspace",
    location: "client",
    risk: "read" as const,
  },
  navigate: {
    capability: "navigate",
    label: "Navigate workspace",
    location: "client",
    risk: "workspace" as const,
  },
  open_compose: {
    capability: "compose",
    label: "Open draft",
    location: "client",
    risk: "workspace" as const,
  },
  save_compose_draft: {
    capability: "save_draft",
    label: "Save draft",
    location: "server",
    risk: "persistent" as const,
  },
  send_mail: {
    capability: "send_mail",
    label: "Send email",
    location: "server",
    risk: "send" as const,
  },
} as const;

export const foregroundClientToolNames = [
  "get_workspace",
  "navigate",
  "open_compose",
  "edit_compose",
] as const;

export type ForegroundClientToolName =
  (typeof foregroundClientToolNames)[number];

export const isForegroundClientToolName = (
  name: string
): name is ForegroundClientToolName =>
  foregroundClientToolNames.some((toolName) => toolName === name);

export const createForegroundClientTools = (): ToolSet => ({
  edit_compose: tool({
    description:
      "Edit an already open, unsaved compose draft. Include its current draftId and expectedDraftRevision. This only edits the visible draft and never saves or sends it.",
    inputSchema: editComposeInputSchema,
    outputSchema: editComposeOutputSchema,
  }),
  get_workspace: tool({
    description:
      "Read the current visible mailbox workspace, including its route, selection, and open draft revision.",
    inputSchema: getWorkspaceInputSchema,
    outputSchema: getWorkspaceOutputSchema,
  }),
  navigate: tool({
    description:
      "Navigate the visible mailbox workspace using a route destination, not browser clicks. This does not change mail.",
    inputSchema: navigateInputSchema,
    outputSchema: navigateOutputSchema,
  }),
  open_compose: tool({
    description:
      "Open an unsaved editable compose draft in the visible workspace. This never saves or sends mail.",
    inputSchema: openComposeInputSchema,
    outputSchema: openComposeOutputSchema,
  }),
});

export const createForegroundServerTools = (
  context: ForegroundServerToolsContext
): ToolSet => ({
  save_compose_draft: tool({
    description:
      "Save this exact reviewed compose draft. The user must approve the payload before it is persisted. If it has attachments or inline images, ask the user to save it from the composer instead.",
    execute: async ({ draft }, { abortSignal, toolCallId }) =>
      await context.saveComposeDraft({ draft, toolCallId }, abortSignal),
    inputSchema: saveComposeDraftInputSchema,
    outputSchema: saveComposeDraftOutputSchema,
  }),
  send_mail: tool({
    description:
      "Send this exact reviewed compose draft. The user must always approve the final recipients, subject, body, and revision before sending. If it has attachments or inline images, ask the user to send it from the composer instead.",
    execute: async ({ draft }, { abortSignal, toolCallId }) =>
      await context.sendMail({ draft, toolCallId }, abortSignal),
    inputSchema: sendMailInputSchema,
    outputSchema: sendMailOutputSchema,
  }),
});
