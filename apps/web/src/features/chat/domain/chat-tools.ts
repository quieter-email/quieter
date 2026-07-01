import {
  composeEmailResultSchema,
  googleCalendarCreateEventResultSchema,
  gmailLabelListResultSchema,
  gmailMessageResultSchema,
  gmailSearchResultSchema,
  gmailThreadResultSchema,
  mailboxOverviewResultSchema,
  modifyMailResultSchema,
} from "@quieter/ai/chat-agent";
import type {
  ComposeEmailResult,
  GoogleCalendarEventToolResult,
  GmailLabelListToolResult,
  GmailMessageToolResult,
  GmailSearchToolResult,
  GmailThreadToolResult,
  MailboxOverviewToolResult,
  ModifyMailToolResult,
} from "../types";

export const parseToolArguments = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value !== "string") {
    return {};
  }

  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
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

const parseLegacyGmailSearchResult = (value: unknown): GmailSearchToolResult | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const result = value as Record<string, unknown>;
  if (typeof result.category !== "string" || typeof result.query !== "string") {
    return null;
  }

  const parsed = gmailSearchResultSchema.safeParse({
    ...result,
    status: typeof result.error === "string" ? "error" : "success",
  });

  return parsed.success ? parsed.data : null;
};

export type ParsedToolResult =
  | { data: ComposeEmailResult; kind: "compose-email" }
  | { data: GoogleCalendarEventToolResult; kind: "google-calendar-event" }
  | { data: GmailLabelListToolResult; kind: "gmail-labels" }
  | { data: GmailMessageToolResult; kind: "gmail-message" }
  | { data: GmailSearchToolResult; kind: "gmail-search" }
  | { data: GmailThreadToolResult; kind: "gmail-thread" }
  | { data: MailboxOverviewToolResult; kind: "mailbox-overview" }
  | { data: ModifyMailToolResult; kind: "modify-mail" }
  | { kind: "unknown"; value: unknown };

export const parseToolResult = (toolName: string, value: unknown): ParsedToolResult => {
  const parsed = parseToolJson(value);

  if (toolName === "compose_email") {
    const result = composeEmailResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "compose-email" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "create_google_calendar_event") {
    const result = googleCalendarCreateEventResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "google-calendar-event" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "search_gmail") {
    const result = gmailSearchResultSchema.safeParse(parsed);
    const data = result.success ? result.data : parseLegacyGmailSearchResult(parsed);
    return data ? { data, kind: "gmail-search" } : { kind: "unknown", value: parsed };
  }

  if (toolName === "read_gmail_thread") {
    const result = gmailThreadResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "gmail-thread" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "get_mailbox_overview") {
    const result = mailboxOverviewResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "mailbox-overview" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "read_gmail_message") {
    const result = gmailMessageResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "gmail-message" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "list_gmail_labels") {
    const result = gmailLabelListResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "gmail-labels" }
      : { kind: "unknown", value: parsed };
  }

  if (toolName === "modify_mail") {
    const result = modifyMailResultSchema.safeParse(parsed);
    return result.success
      ? { data: result.data, kind: "modify-mail" }
      : { kind: "unknown", value: parsed };
  }

  return { kind: "unknown", value: parsed };
};
