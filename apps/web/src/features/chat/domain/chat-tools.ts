import {
  composeEmailResultSchema,
  googleCalendarCreateEventResultSchema,
  gmailAttachmentResultSchema,
  gmailLabelListResultSchema,
  gmailMessageResultSchema,
  gmailMessagesResultSchema,
  gmailSearchResultSchema,
  gmailThreadResultSchema,
  mailboxOverviewResultSchema,
  modifyMailResultSchema,
} from "@quieter/ai/chat-agent";

import type {
  ComposeEmailResult,
  GoogleCalendarEventToolResult,
  GmailAttachmentToolResult,
  GmailLabelListToolResult,
  GmailMessageToolResult,
  GmailMessagesToolResult,
  GmailSearchToolResult,
  GmailThreadToolResult,
  MailboxOverviewToolResult,
  ModifyMailToolResult,
} from "../types";

export const parseToolArguments = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value));
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? Object.fromEntries(Object.entries(parsed))
      : {};
  } catch {
    return {};
  }
};

const parseToolJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

export type ParsedToolResult =
  | { data: ComposeEmailResult; kind: "compose-email" }
  | { data: GoogleCalendarEventToolResult; kind: "google-calendar-event" }
  | { data: GmailAttachmentToolResult; kind: "gmail-attachment" }
  | { data: GmailLabelListToolResult; kind: "gmail-labels" }
  | { data: GmailMessageToolResult; kind: "gmail-message" }
  | { data: GmailMessagesToolResult; kind: "gmail-messages" }
  | { data: GmailSearchToolResult; kind: "gmail-search" }
  | { data: GmailThreadToolResult; kind: "gmail-thread" }
  | { data: MailboxOverviewToolResult; kind: "mailbox-overview" }
  | { data: ModifyMailToolResult; kind: "modify-mail" }
  | { kind: "unknown"; value: unknown };

type ToolResultSchema<T> = {
  safeParse: (
    value: unknown
  ) => { success: true; data: T } | { success: false };
};

const parseToolSchema = <T>(
  schema: ToolResultSchema<T>,
  value: unknown,
  createResult: (data: T) => ParsedToolResult
): ParsedToolResult => {
  const result = schema.safeParse(value);
  return result.success
    ? createResult(result.data)
    : { kind: "unknown", value };
};

export const parseToolResult = (
  toolName: string,
  value: unknown
): ParsedToolResult => {
  const parsed = parseToolJson(value);

  switch (toolName) {
    case "compose_email": {
      return parseToolSchema(composeEmailResultSchema, parsed, (data) => ({
        data,
        kind: "compose-email",
      }));
    }
    case "create_google_calendar_event": {
      return parseToolSchema(
        googleCalendarCreateEventResultSchema,
        parsed,
        (data) => ({ data, kind: "google-calendar-event" })
      );
    }
    case "search_gmail": {
      return parseToolSchema(gmailSearchResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-search",
      }));
    }
    case "read_gmail_thread": {
      return parseToolSchema(gmailThreadResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-thread",
      }));
    }
    case "get_mailbox_overview": {
      return parseToolSchema(mailboxOverviewResultSchema, parsed, (data) => ({
        data,
        kind: "mailbox-overview",
      }));
    }
    case "read_gmail_message": {
      return parseToolSchema(gmailMessageResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-message",
      }));
    }
    case "read_gmail_messages": {
      return parseToolSchema(gmailMessagesResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-messages",
      }));
    }
    case "read_gmail_attachment": {
      return parseToolSchema(gmailAttachmentResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-attachment",
      }));
    }
    case "list_gmail_labels": {
      return parseToolSchema(gmailLabelListResultSchema, parsed, (data) => ({
        data,
        kind: "gmail-labels",
      }));
    }
    case "modify_mail": {
      return parseToolSchema(modifyMailResultSchema, parsed, (data) => ({
        data,
        kind: "modify-mail",
      }));
    }
    default: {
      return { kind: "unknown", value: parsed };
    }
  }
};
