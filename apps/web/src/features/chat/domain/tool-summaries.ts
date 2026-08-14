import type { MessagePart } from "@tanstack/ai";

import { parseToolArguments, parseToolResult } from "./chat-tools";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

export const truncateToolDetail = (value: string, maxLength = 42) => {
  const normalized = value.replaceAll(/^["']|["']$/gu, "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
};

const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

type ToolCounts = {
  attachment: number;
  calendar: number;
  compose: number;
  labels: number;
  linearCreate: number;
  linearMetadata: number;
  message: number;
  modify: number;
  overview: number;
  search: number;
  thread: number;
};

const createToolCounts = (): ToolCounts => ({
  attachment: 0,
  calendar: 0,
  compose: 0,
  labels: 0,
  linearCreate: 0,
  linearMetadata: 0,
  message: 0,
  modify: 0,
  overview: 0,
  search: 0,
  thread: 0,
});

const incrementToolCount = (counts: ToolCounts, call: ToolCall) => {
  switch (call.name) {
    case "compose_email": {
      counts.compose += 1;
      break;
    }
    case "create_google_calendar_event": {
      counts.calendar += 1;
      break;
    }
    case "search_gmail": {
      counts.search += 1;
      break;
    }
    case "read_gmail_thread": {
      counts.thread += 1;
      break;
    }
    case "read_gmail_message": {
      counts.message += 1;
      break;
    }
    case "read_gmail_messages": {
      const { messageIds } = parseToolArguments(call.arguments);
      counts.message += Array.isArray(messageIds) ? messageIds.length : 1;
      break;
    }
    case "read_gmail_attachment": {
      counts.attachment += 1;
      break;
    }
    case "get_mailbox_overview": {
      counts.overview += 1;
      break;
    }
    case "list_gmail_labels": {
      counts.labels += 1;
      break;
    }
    case "modify_mail": {
      counts.modify += 1;
      break;
    }
    case "list_linear_issue_metadata": {
      counts.linearMetadata += 1;
      break;
    }
    case "create_linear_issue": {
      counts.linearCreate += 1;
      break;
    }
    default: {
      break;
    }
  }
};

const summarizePendingTool = (active: ToolCall): string => {
  switch (active.name) {
    case "search_gmail": {
      const { query } = parseToolArguments(active.arguments);
      return typeof query === "string" && query.trim() !== ""
        ? `Searching "${truncateToolDetail(query)}"`
        : "Searching mail";
    }
    case "read_gmail_thread": {
      return "Reading thread";
    }
    case "read_gmail_message": {
      return "Reading message";
    }
    case "read_gmail_messages": {
      return "Reading messages";
    }
    case "read_gmail_attachment": {
      return "Reading attachment";
    }
    case "compose_email": {
      return "Drafting email";
    }
    case "create_google_calendar_event": {
      return "Adding calendar event";
    }
    case "list_linear_issue_metadata": {
      return "Reading Linear workspace";
    }
    case "create_linear_issue": {
      return "Creating Linear issue";
    }
    default: {
      return "Working";
    }
  }
};

const summarizeCompletedTools = (counts: ToolCounts, itemCount: number) => {
  const parts: string[] = [];

  if (counts.search > 0) {
    parts.push(
      counts.search === 1 ? "searched mail" : `searched mail ${counts.search}×`
    );
  }

  if (counts.thread > 0) {
    parts.push(`read ${countLabel(counts.thread, "thread")}`);
  }
  if (counts.message > 0) {
    parts.push(`read ${countLabel(counts.message, "message")}`);
  }
  if (counts.attachment > 0) {
    parts.push(`read ${countLabel(counts.attachment, "attachment")}`);
  }
  if (counts.overview > 0) {
    parts.push("checked mailbox");
  }
  if (counts.labels > 0) {
    parts.push("listed labels");
  }
  if (counts.modify > 0) {
    parts.push(`updated mail ${counts.modify}×`);
  }
  if (counts.compose > 0) {
    parts.push(
      counts.compose === 1
        ? "drafted email"
        : `drafted ${counts.compose} emails`
    );
  }
  if (counts.calendar > 0) {
    parts.push(
      counts.calendar === 1
        ? "added calendar event"
        : `added ${counts.calendar} calendar events`
    );
  }
  if (counts.linearMetadata > 0) {
    parts.push("checked Linear");
  }
  if (counts.linearCreate > 0) {
    parts.push(
      counts.linearCreate === 1
        ? "created Linear issue"
        : `created ${counts.linearCreate} Linear issues`
    );
  }

  return parts.length === 0
    ? `${itemCount} step${itemCount === 1 ? "" : "s"}`
    : parts.join(", ");
};

export const summarizeToolCalls = (
  items: { call: ToolCall; pending: boolean; result?: ToolResult }[]
) => {
  const counts = createToolCounts();
  for (const { call } of items) {
    incrementToolCount(counts, call);
  }

  const active = items.find((item) => item.pending)?.call;
  return active === undefined
    ? summarizeCompletedTools(counts, items.length)
    : summarizePendingTool(active);
};

const getSuccessfulSubject = (
  parsed: ReturnType<typeof parseToolResult>,
  kind: "gmail-thread" | "gmail-message"
) => {
  if (parsed.kind !== kind || parsed.data.status !== "success") {
    return null;
  }
  const { subject } = parsed.data;
  return typeof subject === "string" && subject !== "" ? subject : null;
};

const getToolDetailForThread = (
  args: Record<string, unknown>,
  parsed: ReturnType<typeof parseToolResult>
) =>
  getSuccessfulSubject(parsed, "gmail-thread") ??
  (typeof args.threadId === "string"
    ? truncateToolDetail(args.threadId, 16)
    : undefined);

const getToolDetailForCalendar = (
  args: Record<string, unknown>,
  parsed: ReturnType<typeof parseToolResult>
) => {
  if (
    parsed.kind === "google-calendar-event" &&
    parsed.data.status === "success"
  ) {
    return parsed.data.summary
      ? truncateToolDetail(parsed.data.summary)
      : undefined;
  }
  return typeof args.summary === "string"
    ? truncateToolDetail(args.summary)
    : undefined;
};

const getToolDetailForLinearIssue = (
  args: Record<string, unknown>,
  parsed: ReturnType<typeof parseToolResult>
) => {
  if (
    parsed.kind === "linear-issue-create" &&
    parsed.data.status === "success"
  ) {
    return parsed.data.title
      ? truncateToolDetail(parsed.data.title)
      : undefined;
  }
  return typeof args.title === "string"
    ? truncateToolDetail(args.title)
    : undefined;
};

const getToolDetailForAttachment = (
  parsed: ReturnType<typeof parseToolResult>
) => {
  if (
    parsed.kind === "gmail-attachment" &&
    parsed.data.status === "success" &&
    parsed.data.fileName
  ) {
    return truncateToolDetail(parsed.data.fileName);
  }
  return null;
};

const getToolDetailForCompose = (args: Record<string, unknown>) => {
  if (typeof args.subject === "string" && args.subject.trim() !== "") {
    return truncateToolDetail(args.subject);
  }
  return null;
};

const getToolDetailForLinearMetadata = (
  parsed: ReturnType<typeof parseToolResult>
) => {
  if (
    parsed.kind === "linear-issue-metadata" &&
    parsed.data.status === "success"
  ) {
    return countLabel(parsed.data.teams.length, "team");
  }
  return null;
};

const toOptionalDetail = (detail: string | null): string | undefined =>
  detail === null || detail === "" ? undefined : detail;

export const getActiveToolDetail = (
  call: ToolCall,
  result?: ToolResult
): string | undefined => {
  const args = parseToolArguments(call.arguments);
  const parsed = parseToolResult(call.name, result?.content ?? "");

  switch (call.name) {
    case "search_gmail": {
      return typeof args.query === "string"
        ? truncateToolDetail(args.query)
        : undefined;
    }
    case "read_gmail_thread": {
      return getToolDetailForThread(args, parsed);
    }
    case "read_gmail_message": {
      const subject = getSuccessfulSubject(parsed, "gmail-message");
      return toOptionalDetail(
        subject === null ? null : truncateToolDetail(subject)
      );
    }
    case "read_gmail_messages": {
      const { messageIds } = args;
      return Array.isArray(messageIds)
        ? countLabel(messageIds.length, "message")
        : undefined;
    }
    case "read_gmail_attachment": {
      return toOptionalDetail(getToolDetailForAttachment(parsed));
    }
    case "compose_email": {
      return toOptionalDetail(getToolDetailForCompose(args));
    }
    case "create_google_calendar_event": {
      return getToolDetailForCalendar(args, parsed);
    }
    case "list_linear_issue_metadata": {
      return toOptionalDetail(getToolDetailForLinearMetadata(parsed));
    }
    case "create_linear_issue": {
      return getToolDetailForLinearIssue(args, parsed);
    }
    default: {
      return undefined;
    }
  }
};

export const shouldUngroupTool = (call: ToolCall) =>
  call.name === "compose_email";
