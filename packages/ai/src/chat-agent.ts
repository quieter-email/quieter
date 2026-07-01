import { MAILBOX_LABELS, type MailboxCategory } from "@quieter/gmail";
import { toolDefinition, type ServerTool } from "@tanstack/ai";
import { z } from "zod";

const mailboxCategories = Object.keys(MAILBOX_LABELS) as MailboxCategory[];

export const gmailToolsPrompt = `You are Quieter's email assistant — an autonomous agent embedded in the user's mailbox. Your job is to understand what they want, investigate their mail when needed, and deliver useful outcomes without making them micromanage every step.

## Operating mode

You are agentic. Think before you act, plan multi-step work, call tools proactively, and keep going until the request is actually resolved or you hit a genuine blocker. Do not behave like a passive Q&A bot that only answers when every detail is spelled out.

Infer intent from context: the current message, earlier turns in the chat, and what a reasonable person would want in an email client. When the user's goal is clear enough to act on, act. Fill in sensible defaults instead of asking permission for obvious next steps.

Ask a clarifying question only when:
- multiple materially different outcomes are equally plausible and the choice matters
- a missing fact cannot be recovered with tools or reasonable assumptions
- the user explicitly asked you to wait for their input

Do not ask:
- "Would you like me to search your inbox?" when they already asked about a message
- "Should I read the full thread?" when they asked for a summary or reply help
- "Do you want me to draft an email?" when they already asked you to write one
- for recipient/subject/body details you can reasonably infer from the thread or request

When uncertain, prefer a best-effort attempt with tools, then explain assumptions briefly in your reply.

## Planning and persistence

Before your first tool call on a mail-related task, decide what evidence you need and in what order. Typical flows:
- vague question about mail → search_gmail → read_gmail_thread on the best match(es) → answer
- "what's new" / inbox status → get_mailbox_overview, optionally search_gmail for recent unread
- summarize or reply to a thread → read_gmail_thread first, then answer or compose_email
- find then act → search, read, then compose or recommend action

Use multiple tool rounds when useful. If a search is too broad, refine the query and search again. If the first thread is not the right one, check the next candidate. If a tool errors, try an alternative query or approach before giving up.

Keep internal reasoning thorough; keep user-facing text concise unless they asked for depth.

## Ground truth and honesty

Never invent mailbox contents, senders, dates, subjects, thread details, or counts. All mail facts must come from tool results in this conversation.

If tools return nothing useful, say so plainly and suggest a concrete next search or filter the user could try.

If you proposed an email and the user declined or edited it in the composer, respect that outcome and continue from the tool result.

## Tools

### search_gmail
Find messages in the selected mailbox. Returns up to 50 summaries per call — honor the user's requested count when it is 50 or fewer. Prefer precise Gmail operators over vague keywords. Start narrow; broaden only when needed.

### read_gmail_thread
Read a full conversation with bounded bodies. Use when summaries are insufficient: replying, summarizing, extracting commitments, comparing messages, or verifying tone/context. Prefer threadId values returned by search_gmail.

### get_mailbox_overview
Get mailbox totals plus estimated unread, starred, and attachment counts. Use for high-level status questions and to decide whether a deeper search is warranted.

### read_gmail_message
Read one Gmail message with its full body and attachment metadata. Use when you already have a message id from search_gmail and need the complete content without loading the whole thread.

### list_gmail_labels
List the user's Gmail labels, including system and custom labels. Use when the user asks about labels or you need label ids/names before organizing mail.

### modify_mail
Apply a mailbox action to a message or thread: mark_read, mark_unread, star, unstar, archive, trash, or untrash. Prefer thread scope when the user is acting on a conversation. Confirm destructive actions only when intent is ambiguous.

### compose_email
Open an editable inline composer with a proposed message. Use when the user wants you to write, draft, or send mail and you have enough to propose a strong first draft. The tool never sends or saves by itself. Put the complete proposed plain-text body in bodyText. The user must explicitly Send, Save draft, or Decline; you receive that outcome before continuing.

When drafting:
- match the user's language and tone unless they ask otherwise
- for replies/forwards, read the thread first when possible
- include a clear subject; use "Re:" / "Fwd:" when appropriate
- leave to/cc/bcc empty only when truly unknown; otherwise make a reasonable guess and note it briefly

## Gmail search syntax

search_gmail accepts free text and Gmail operators. Use operators whenever they improve precision:
from:, to:, cc:, bcc:, subject:, after:, before:, older:, newer:, older_than:, newer_than:, OR, { }, AND, -, AROUND, label:, category:primary/social/promotions/updates/forums/reservations/purchases, has:attachment/youtube/drive/document/spreadsheet/presentation, list:, filename:, quoted exact phrases, parentheses, in:anywhere, in:archive, in:snoozed, is:muted, is:important/starred/unread/read, has:yellow-star/orange-star/red-star/purple-star/blue-star/green-star/red-bang/orange-guillemet/yellow-bang/green-check/blue-info/purple-question, deliveredto:, size:, larger:, smaller:, +term, rfc822msgid:, has:userlabels, has:nouserlabels, label:encryptedmail.

## Non-mail conversation

When the user asks general questions that do not require mailbox data, answer directly without tools. Do not search mail "just in case."

## Response style

Lead with the answer or outcome. Use short paragraphs or bullets for lists, action items, or multiple messages. Quote sparingly. When you made assumptions, state them in one short clause instead of a questionnaire.

Be helpful, direct, and confident — not hesitant, not overly verbose, and not robotic.`;

export const googleCalendarToolsPrompt = `Google Calendar is connected for this user.

Use create_google_calendar_event only when the user clearly asks to create or schedule a calendar event. Ask a concise clarifying question if the date, start time, or end time is missing or materially ambiguous. Use the user's timezone when they state one; otherwise use a timezone already present in the conversation when possible.

The tool creates events on the user's primary Google Calendar. Do not claim an event was created unless the tool returns success.`;

const toolErrorSchema = z.object({
  error: z.string(),
  status: z.literal("error"),
});

export const gmailSearchResultSchema = z.discriminatedUnion("status", [
  z.object({
    category: z.enum(mailboxCategories),
    messages: z.array(
      z.object({
        date: z.string().optional(),
        from: z.string().optional(),
        id: z.string(),
        isUnread: z.boolean().optional(),
        labelIds: z.array(z.string()).optional(),
        snippet: z.string().optional(),
        subject: z.string().optional(),
        threadId: z.string(),
      }),
    ),
    query: z.string(),
    resultSizeEstimate: z.number().optional(),
    status: z.literal("success"),
  }),
  toolErrorSchema.extend({
    category: z.enum(mailboxCategories),
    query: z.string(),
  }),
]);

export type GmailSearchResult = z.infer<typeof gmailSearchResultSchema>;

export const gmailSearchToolDef = toolDefinition({
  name: "search_gmail",
  description:
    "Search the selected Gmail mailbox with Gmail search syntax and return matching message summaries.",
  inputSchema: z.object({
    query: z.string().trim().min(1).max(500).meta({
      description: "Gmail search query. Can be free text or use Gmail operators.",
    }),
    maxResults: z.number().int().min(1).max(50).default(10).meta({
      description: "Maximum summaries to return. Match the user's requested count, up to 50.",
    }),
  }),
  outputSchema: gmailSearchResultSchema,
});

export const gmailThreadResultSchema = z.discriminatedUnion("status", [
  z.object({
    category: z.enum(mailboxCategories),
    messages: z.array(
      z.object({
        attachmentCount: z.number().int().nonnegative(),
        body: z.string(),
        bodyTruncated: z.boolean(),
        date: z.string().optional(),
        from: z.string().optional(),
        id: z.string(),
        isUnread: z.boolean().optional(),
        snippet: z.string().optional(),
        to: z.string().optional(),
      }),
    ),
    omittedMessageCount: z.number().int().nonnegative(),
    snippet: z.string().optional(),
    status: z.literal("success"),
    subject: z.string().optional(),
    threadId: z.string(),
  }),
  toolErrorSchema.extend({
    category: z.enum(mailboxCategories),
    threadId: z.string(),
  }),
]);

export type GmailThreadResult = z.infer<typeof gmailThreadResultSchema>;

export const gmailThreadToolDef = toolDefinition({
  name: "read_gmail_thread",
  description:
    "Read the selected Gmail conversation, including bounded message bodies and attachment counts.",
  inputSchema: z.object({
    threadId: z.string().trim().min(1).max(256).meta({
      description: "Gmail thread id, usually from a search_gmail result.",
    }),
  }),
  outputSchema: gmailThreadResultSchema,
});

export const mailboxOverviewResultSchema = z.discriminatedUnion("status", [
  z.object({
    attachmentMessages: z.number().nonnegative().optional(),
    category: z.enum(mailboxCategories),
    categoryMessages: z.number().nonnegative().optional(),
    emailAddress: z.string(),
    starredMessages: z.number().nonnegative().optional(),
    status: z.literal("success"),
    totalMessages: z.number().nonnegative().optional(),
    totalThreads: z.number().nonnegative().optional(),
    unreadMessages: z.number().nonnegative().optional(),
  }),
  toolErrorSchema.extend({
    category: z.enum(mailboxCategories),
  }),
]);

export type MailboxOverviewResult = z.infer<typeof mailboxOverviewResultSchema>;

export const composeEmailInputSchema = z.object({
  to: z.string().default("").meta({
    description: "To recipients as a comma-separated email address list.",
  }),
  cc: z.string().default("").meta({
    description: "Cc recipients as a comma-separated email address list.",
  }),
  bcc: z.string().default("").meta({
    description: "Bcc recipients as a comma-separated email address list.",
  }),
  subject: z.string().default("").meta({
    description: "Proposed email subject.",
  }),
  bodyText: z.string().default("").meta({
    description: "Complete proposed plain-text email body.",
  }),
});

export const composeEmailResultSchema = z.discriminatedUnion("status", [
  z.object({
    messageId: z.string().optional(),
    status: z.literal("sent"),
    subject: z.string(),
    threadId: z.string().optional(),
    to: z.string(),
  }),
  z.object({
    draftId: z.string(),
    messageId: z.string().optional(),
    status: z.literal("draft_saved"),
    subject: z.string(),
    to: z.string(),
  }),
  z.object({
    status: z.literal("declined"),
    subject: z.string().optional(),
    to: z.string().optional(),
  }),
]);

export type ComposeEmailInput = z.infer<typeof composeEmailInputSchema>;
export type ComposeEmailResult = z.infer<typeof composeEmailResultSchema>;

export const composeEmailToolDef = toolDefinition({
  name: "compose_email",
  description:
    "Open an editable inline email composer with a proposed message. The user must explicitly send, save the draft, or decline before the assistant continues.",
  inputSchema: composeEmailInputSchema,
  outputSchema: composeEmailResultSchema,
  needsApproval: true,
});

export const mailboxOverviewToolDef = toolDefinition({
  name: "get_mailbox_overview",
  description:
    "Get totals and estimated unread, starred, and attachment message counts for the selected mailbox.",
  inputSchema: z.object({}),
  outputSchema: mailboxOverviewResultSchema,
});

export const gmailMessageResultSchema = z.discriminatedUnion("status", [
  z.object({
    attachmentCount: z.number().int().nonnegative(),
    body: z.string(),
    bodyTruncated: z.boolean(),
    category: z.enum(mailboxCategories),
    date: z.string().optional(),
    from: z.string().optional(),
    id: z.string(),
    isUnread: z.boolean().optional(),
    labelIds: z.array(z.string()).optional(),
    snippet: z.string().optional(),
    status: z.literal("success"),
    subject: z.string().optional(),
    threadId: z.string(),
    to: z.string().optional(),
  }),
  toolErrorSchema.extend({
    category: z.enum(mailboxCategories),
    messageId: z.string(),
  }),
]);

export type GmailMessageResult = z.infer<typeof gmailMessageResultSchema>;

export const gmailMessageToolDef = toolDefinition({
  name: "read_gmail_message",
  description: "Read one Gmail message with its full body and attachment metadata.",
  inputSchema: z.object({
    messageId: z.string().trim().min(1).max(256).meta({
      description: "Gmail message id, usually from a search_gmail result.",
    }),
  }),
  outputSchema: gmailMessageResultSchema,
});

export const gmailLabelListResultSchema = z.discriminatedUnion("status", [
  z.object({
    category: z.enum(mailboxCategories),
    labels: z.array(
      z.object({
        description: z.string().nullable().optional(),
        id: z.string(),
        inclusionCriteria: z.string().nullable().optional(),
        name: z.string(),
        type: z.enum(["system", "user"]),
      }),
    ),
    status: z.literal("success"),
  }),
  toolErrorSchema.extend({
    category: z.enum(mailboxCategories),
  }),
]);

export type GmailLabelListResult = z.infer<typeof gmailLabelListResultSchema>;

export const gmailLabelListToolDef = toolDefinition({
  name: "list_gmail_labels",
  description: "List Gmail labels available in the selected mailbox.",
  inputSchema: z.object({}),
  outputSchema: gmailLabelListResultSchema,
});

const modifyMailActions = [
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "archive",
  "trash",
  "untrash",
] as const;

export const modifyMailResultSchema = z.discriminatedUnion("status", [
  z.object({
    action: z.enum(modifyMailActions),
    category: z.enum(mailboxCategories),
    id: z.string(),
    status: z.literal("success"),
    target: z.enum(["message", "thread"]),
  }),
  toolErrorSchema.extend({
    action: z.enum(modifyMailActions),
    category: z.enum(mailboxCategories),
    id: z.string(),
    target: z.enum(["message", "thread"]),
  }),
]);

export type ModifyMailResult = z.infer<typeof modifyMailResultSchema>;

export const modifyMailToolDef = toolDefinition({
  name: "modify_mail",
  description:
    "Apply a mailbox action to a Gmail message or thread: mark_read, mark_unread, star, unstar, archive, trash, or untrash.",
  inputSchema: z.object({
    action: z.enum(modifyMailActions).meta({
      description: "Mailbox action to apply.",
    }),
    id: z.string().trim().min(1).max(256).meta({
      description: "Gmail message id or thread id, depending on target.",
    }),
    target: z.enum(["message", "thread"]).meta({
      description: "Whether id refers to a message or a thread.",
    }),
  }),
  outputSchema: modifyMailResultSchema,
});

const googleCalendarEventDateSchema = z
  .object({
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .meta({
        description: "All-day event date in YYYY-MM-DD format.",
      }),
    dateTime: z.string().trim().min(1).optional().meta({
      description: "Timed event start or end as an ISO-like date-time.",
    }),
    timeZone: z.string().trim().min(1).optional().meta({
      description: "IANA timezone name for dateTime values, such as Europe/Berlin.",
    }),
  })
  .refine((value) => Boolean(value.date) !== Boolean(value.dateTime), {
    message: "Provide exactly one of date or dateTime.",
  });

export const googleCalendarCreateEventInputSchema = z.object({
  summary: z.string().trim().min(1).max(200).meta({
    description: "Event title.",
  }),
  description: z.string().trim().max(5_000).optional().meta({
    description: "Optional event notes.",
  }),
  location: z.string().trim().max(1_000).optional().meta({
    description: "Optional event location.",
  }),
  start: googleCalendarEventDateSchema.meta({
    description: "Event start date or date-time.",
  }),
  end: googleCalendarEventDateSchema.meta({
    description: "Event end date or date-time.",
  }),
});

export const googleCalendarCreateEventResultSchema = z.discriminatedUnion("status", [
  z.object({
    htmlLink: z.string().optional(),
    id: z.string(),
    status: z.literal("success"),
    summary: z.string(),
  }),
  toolErrorSchema.extend({
    summary: z.string(),
  }),
]);

export type GoogleCalendarCreateEventInput = z.infer<typeof googleCalendarCreateEventInputSchema>;
export type GoogleCalendarCreateEventResult = z.infer<typeof googleCalendarCreateEventResultSchema>;

export const googleCalendarCreateEventToolDef = toolDefinition({
  name: "create_google_calendar_event",
  description: "Create an event on the user's connected Google Calendar.",
  inputSchema: googleCalendarCreateEventInputSchema,
  outputSchema: googleCalendarCreateEventResultSchema,
});

export type GmailToolsContext = {
  category: MailboxCategory;
  getMailboxOverview: () => Promise<MailboxOverviewResult>;
  listGmailLabels: () => Promise<GmailLabelListResult>;
  modifyMail: (input: {
    action: (typeof modifyMailActions)[number];
    id: string;
    target: "message" | "thread";
  }) => Promise<ModifyMailResult>;
  readGmailMessage: (input: { messageId: string }) => Promise<GmailMessageResult>;
  readGmailThread: (input: { threadId: string }) => Promise<GmailThreadResult>;
  searchGmail: (input: { maxResults: number; query: string }) => Promise<GmailSearchResult>;
};

export type GoogleCalendarToolsContext = {
  createGoogleCalendarEvent: (
    input: GoogleCalendarCreateEventInput,
  ) => Promise<GoogleCalendarCreateEventResult>;
};

export const createGmailSearchServerTool = (context: GmailToolsContext): ServerTool =>
  gmailSearchToolDef.server(async ({ query, maxResults }) => {
    try {
      return await context.searchGmail({ maxResults: maxResults ?? 10, query });
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Gmail search failed.",
        query,
        status: "error",
      };
    }
  });

export const createGmailThreadServerTool = (context: GmailToolsContext): ServerTool =>
  gmailThreadToolDef.server(async ({ threadId }) => {
    try {
      return await context.readGmailThread({ threadId });
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Could not read the Gmail thread.",
        status: "error",
        threadId,
      };
    }
  });

export const createMailboxOverviewServerTool = (context: GmailToolsContext): ServerTool =>
  mailboxOverviewToolDef.server(async () => {
    try {
      return await context.getMailboxOverview();
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Could not inspect the mailbox.",
        status: "error",
      };
    }
  });

export const createGmailMessageServerTool = (context: GmailToolsContext): ServerTool =>
  gmailMessageToolDef.server(async ({ messageId }) => {
    try {
      return await context.readGmailMessage({ messageId });
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Could not read the Gmail message.",
        messageId,
        status: "error",
      };
    }
  });

export const createGmailLabelListServerTool = (context: GmailToolsContext): ServerTool =>
  gmailLabelListToolDef.server(async () => {
    try {
      return await context.listGmailLabels();
    } catch (error) {
      return {
        category: context.category,
        error: error instanceof Error ? error.message : "Could not list Gmail labels.",
        status: "error",
      };
    }
  });

export const createModifyMailServerTool = (context: GmailToolsContext): ServerTool =>
  modifyMailToolDef.server(async ({ action, id, target }) => {
    try {
      return await context.modifyMail({ action, id, target });
    } catch (error) {
      return {
        action,
        category: context.category,
        error: error instanceof Error ? error.message : "Could not modify the mail.",
        id,
        status: "error",
        target,
      };
    }
  });

export const createGoogleCalendarEventServerTool = (
  context: GoogleCalendarToolsContext,
): ServerTool =>
  googleCalendarCreateEventToolDef.server(async (input) => {
    try {
      return await context.createGoogleCalendarEvent(input);
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Could not create the calendar event.",
        status: "error",
        summary: input.summary,
      };
    }
  });
