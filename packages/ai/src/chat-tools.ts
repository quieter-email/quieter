import {
  calendarAccountSchema,
  calendarCreateInputSchema,
  calendarDateSchema,
  calendarDeleteInputSchema,
  calendarEventSchema,
  calendarRespondInputSchema,
  calendarSummarySchema,
  calendarTimeZoneSchema,
  calendarUpdateInputSchema,
  calendarViewSchema,
  calendarWorkspaceSchema,
} from "@quieter/calendar";
import type {
  CalendarAccount,
  CalendarEvent,
  CalendarEventTime,
  CalendarSummary,
} from "@quieter/calendar";
import {
  composeDraftAnchorSchema,
  composeSenderNameSchema,
} from "@quieter/mail/compose/schema";
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

export const assistantCapabilitySchema = z.enum([
  "navigate",
  "compose",
  "edit_compose",
  "save_draft",
  "send_mail",
  "modify_mail",
  "modify_calendar",
]);

export const workspaceViewSchema = z.enum([
  "inbox",
  "unread",
  "archive",
  "spam",
  "sent",
  "trash",
  "drafts",
  "snippets",
  "labels",
  "compose",
  "calendar",
]);
export const navigableWorkspaceViewSchema = workspaceViewSchema.exclude([
  "compose",
  "calendar",
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
    sourceMessageId: optionalIdentifier,
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
    calendar: calendarWorkspaceSchema.optional(),
    capabilities: z.array(assistantCapabilitySchema).max(7),
    draftId: optionalIdentifier,
    draftRevision: z.number().int().nonnegative().optional(),
    exchangeId: z.uuid(),
    expiresAt: z.number().int().positive(),
    generation: z.number().int().positive(),
    query: z.string().trim().max(500).optional(),
    selectedMessageId: optionalIdentifier,
    selectedThreadId: optionalIdentifier,
    tabId: z.string().trim().min(1).max(128),
    view: workspaceViewSchema.optional(),
    workspace: z.enum(["mail", "calendar"]).optional(),
  })
  .strip();

export type ForegroundSnapshot = z.infer<typeof foregroundSnapshotSchema>;

export const foregroundComposeDraftSchema = z
  .object({
    attachments: z.array(foregroundComposeAttachmentSchema).max(100),
    baseRevision: optionalIdentifier,
    bcc: optionalText,
    bodyHtml: z.string().max(100_000),
    bodyText: optionalText,
    cc: optionalText,
    draftAnchor: composeDraftAnchorSchema.nullable().optional(),
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    inlineImages: z.array(foregroundComposeInlineImageSchema).max(100),
    messageId: optionalIdentifier,
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
    sendOperationId: z.uuid().optional(),
    sendUncertain: z.boolean().optional(),
    senderName: composeSenderNameSchema.optional(),
    subject: optionalText,
    to: optionalText,
  })
  .strict();

const workspaceResultSchema = z
  .object({
    calendar: calendarWorkspaceSchema.optional(),
    draft: foregroundComposeDraftSchema.optional(),
    draftId: optionalIdentifier,
    draftRevision: z.number().int().nonnegative().optional(),
    generation: z.number().int().positive(),
    mailboxId: z.string().trim().min(1).max(128),
    query: z.string().trim().max(500).optional(),
    selectedMessageId: optionalIdentifier,
    selectedThreadId: optionalIdentifier,
    view: workspaceViewSchema.optional(),
    workspace: z.enum(["mail", "calendar"]).optional(),
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
  .strict();
export const navigateOutputSchema = workspaceResultSchema;

export const navigateCalendarInputSchema = z
  .object({
    calendarId: optionalIdentifier,
    connectionId: optionalIdentifier,
    date: calendarDateSchema.optional(),
    eventId: optionalIdentifier,
    timeZone: calendarTimeZoneSchema.optional(),
    view: calendarViewSchema.optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.eventId === undefined ||
      (input.connectionId !== undefined && input.calendarId !== undefined),
    "An event destination needs its account and calendar."
  );
export const navigateCalendarOutputSchema = workspaceResultSchema;

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
    attachments: z.array(foregroundComposeAttachmentSchema).optional(),
    baseRevision: optionalIdentifier,
    draftId: z.string().trim().min(1).max(256),
    draftRevision: z.number().int().nonnegative(),
    inlineImages: z.array(foregroundComposeInlineImageSchema).optional(),
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

export const calendarToolErrorSchema = z.object({
  error: z.string(),
  status: z.literal("error"),
});
export const calendarListToolResultSchema = z.object({
  accounts: z.array(calendarAccountSchema),
  calendars: z.array(calendarSummarySchema),
  fetchedAt: z.iso.datetime(),
  status: z.literal("success"),
});
export const calendarEventsToolResultSchema = z.object({
  events: z.array(calendarEventSchema),
  fetchedAt: z.iso.datetime(),
  status: z.literal("success"),
});
export const calendarEventToolResultSchema = z.object({
  event: calendarEventSchema,
  fetchedAt: z.iso.datetime(),
  status: z.literal("success"),
});

export const calendarWriteInputSchemas = {
  create_calendar_event: calendarCreateInputSchema.omit({ operationId: true }),
  delete_calendar_event: calendarDeleteInputSchema,
  respond_to_calendar_event: calendarRespondInputSchema,
  update_calendar_event: calendarUpdateInputSchema,
} as const;
export type CalendarWriteToolName = keyof typeof calendarWriteInputSchemas;
export const calendarWriteToolNames = Object.keys(calendarWriteInputSchemas);
export const approvalRequiredToolNames = [
  "send_mail",
  ...calendarWriteToolNames,
];

export const isCalendarWriteToolName = (
  name: string
): name is CalendarWriteToolName =>
  Object.hasOwn(calendarWriteInputSchemas, name);

export type CalendarWriteReview = {
  account: CalendarAccount;
  calendar: CalendarSummary;
  previousEvent?: CalendarEvent;
  scope: "event" | "occurrence" | "series";
  time: CalendarEventTime;
  title: string;
};

export const resolveCalendarWriteReview = ({
  input,
  toolName,
  transcript,
}: {
  input: unknown;
  toolName: CalendarWriteToolName;
  transcript: readonly { parts: readonly unknown[] }[];
}): CalendarWriteReview | undefined => {
  const command = calendarWriteInputSchemas[toolName].safeParse(input);
  if (!command.success) {
    return undefined;
  }
  const parts = transcript.flatMap((message) => message.parts);
  let account: CalendarAccount | undefined;
  let calendar: CalendarSummary | undefined;
  let previousEvent: CalendarEvent | undefined;
  for (const part of parts) {
    if (
      typeof part !== "object" ||
      part === null ||
      Reflect.get(part, "state") !== "output-available"
    ) {
      continue;
    }
    if (Reflect.get(part, "type") === "tool-list_calendars") {
      const listed = calendarListToolResultSchema.safeParse(
        Reflect.get(part, "output")
      );
      if (listed.success) {
        account =
          listed.data.accounts.find(
            (candidate) => candidate.id === command.data.connectionId
          ) ?? account;
        calendar =
          listed.data.calendars.find(
            (candidate) =>
              candidate.connectionId === command.data.connectionId &&
              candidate.calendarId === command.data.calendarId
          ) ?? calendar;
      }
    }
    if (
      Reflect.get(part, "type") === "tool-get_calendar_event" &&
      "eventId" in command.data
    ) {
      const read = calendarEventToolResultSchema.safeParse(
        Reflect.get(part, "output")
      );
      if (
        read.success &&
        read.data.event.connectionId === command.data.connectionId &&
        read.data.event.calendarId === command.data.calendarId &&
        read.data.event.eventId === command.data.eventId &&
        read.data.event.version === command.data.version
      ) {
        previousEvent = read.data.event;
      }
    }
  }
  if (account === undefined || calendar === undefined) {
    return undefined;
  }
  if ("event" in command.data) {
    return {
      account,
      calendar,
      scope: command.data.event.recurrence.length > 0 ? "series" : "event",
      time: command.data.event.time,
      title: command.data.event.title,
    };
  }
  if (previousEvent === undefined) {
    return undefined;
  }
  const changes =
    toolName === "update_calendar_event"
      ? calendarUpdateInputSchema.parse(input).changes
      : undefined;
  let scope: CalendarWriteReview["scope"] = "event";
  if (previousEvent.recurringEventId !== undefined) {
    scope = "occurrence";
  } else if (previousEvent.recurrence.length > 0) {
    scope = "series";
  }
  return {
    account,
    calendar,
    previousEvent,
    scope,
    time: changes?.time ?? previousEvent.time,
    title: changes?.title ?? previousEvent.title,
  };
};

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
  navigate_calendar: {
    capability: "navigate",
    label: "Navigate calendar",
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
  "navigate_calendar",
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
      "Read the current visible workspace. Calendar includes its displayed date, view, time zone, visible calendars and selected event. Mail includes its route, selection and open draft revision.",
    inputSchema: getWorkspaceInputSchema,
    outputSchema: getWorkspaceOutputSchema,
  }),
  navigate: tool({
    description:
      "Open Mail and optionally navigate to a mailbox route destination. Pass an empty object to restore the retained Mail selection. This preserves Calendar's independent state and does not change mail.",
    inputSchema: navigateInputSchema,
    outputSchema: navigateOutputSchema,
  }),
  navigate_calendar: tool({
    description:
      "Open Calendar and optionally navigate its displayed date, view, time zone or a known event. Pass an empty object to restore the retained Calendar selection. Use account, calendar and event IDs from calendar tools. This preserves the retained Mail selection and never changes events.",
    inputSchema: navigateCalendarInputSchema,
    outputSchema: navigateCalendarOutputSchema,
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
      "Save this exact visible compose draft. If it has attachments or inline images, ask the user to save it from the composer instead.",
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
