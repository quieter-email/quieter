import {
  aiMemoryResultSchema,
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

export type ChatToolApproval = {
  approve: (editedArgs?: Record<string, unknown>) => void;
  canResolve: boolean;
  id: string;
  originalArgs: unknown;
  reject: () => void;
  status: "pending" | "validating" | "staged" | "submitting" | "error";
  toolCallId: string;
  toolName: string;
};

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

const parseJson = (value: unknown): unknown => {
  if (typeof value !== "string") {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

type ResultSchema = {
  safeParse: (
    value: unknown
  ) => { data: unknown; success: true } | { success: false };
};

const parseWithSchema = (schema: ResultSchema, value: unknown) => {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : value;
};

export const parseToolResult = (name: string, content: unknown): unknown => {
  const value = parseJson(content);
  switch (name) {
    case "compose_email": {
      return parseWithSchema(composeEmailResultSchema, value);
    }
    case "create_google_calendar_event": {
      return parseWithSchema(googleCalendarCreateEventResultSchema, value);
    }
    case "get_mailbox_overview": {
      return parseWithSchema(mailboxOverviewResultSchema, value);
    }
    case "list_gmail_labels": {
      return parseWithSchema(gmailLabelListResultSchema, value);
    }
    case "memory": {
      return parseWithSchema(aiMemoryResultSchema, value);
    }
    case "modify_mail": {
      return parseWithSchema(modifyMailResultSchema, value);
    }
    case "read_gmail_attachment": {
      return parseWithSchema(gmailAttachmentResultSchema, value);
    }
    case "read_gmail_message": {
      return parseWithSchema(gmailMessageResultSchema, value);
    }
    case "read_gmail_messages": {
      return parseWithSchema(gmailMessagesResultSchema, value);
    }
    case "read_gmail_thread": {
      return parseWithSchema(gmailThreadResultSchema, value);
    }
    case "search_gmail": {
      return parseWithSchema(gmailSearchResultSchema, value);
    }
    default: {
      return value;
    }
  }
};

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getString = (value: unknown, key: string) =>
  isRecord(value) && typeof value[key] === "string" ? value[key] : "";

export const humanizeToolName = (name: string) =>
  name
    .replace(/^linear[-_:]?/u, "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/^./u, (character) => character.toUpperCase());
