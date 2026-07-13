import type { MessagePart } from "@tanstack/ai";
import { parseToolArguments, parseToolResult } from "./chat-tools";

type ToolCall = Extract<MessagePart, { type: "tool-call" }>;
type ToolResult = Extract<MessagePart, { type: "tool-result" }>;

export const truncateToolDetail = (value: string, maxLength = 42) => {
  const normalized = value.replace(/^["']|["']$/g, "").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
};

const countLabel = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const summarizeToolCalls = (
  items: Array<{ call: ToolCall; pending: boolean; result?: ToolResult }>,
) => {
  const counts = {
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
  };
  let pendingCount = 0;

  for (const { call, pending } of items) {
    if (pending) {
      pendingCount += 1;
    }

    if (call.name === "compose_email") {
      counts.compose += 1;
      continue;
    }

    if (call.name === "create_google_calendar_event") {
      counts.calendar += 1;
      continue;
    }

    if (call.name === "search_gmail") {
      counts.search += 1;
      continue;
    }

    if (call.name === "read_gmail_thread") {
      counts.thread += 1;
      continue;
    }

    if (call.name === "read_gmail_message") {
      counts.message += 1;
      continue;
    }

    if (call.name === "read_gmail_messages") {
      const messageIds = parseToolArguments(call.arguments).messageIds;
      counts.message += Array.isArray(messageIds) ? messageIds.length : 1;
      continue;
    }

    if (call.name === "read_gmail_attachment") {
      counts.attachment += 1;
      continue;
    }

    if (call.name === "get_mailbox_overview") {
      counts.overview += 1;
      continue;
    }

    if (call.name === "list_gmail_labels") {
      counts.labels += 1;
      continue;
    }

    if (call.name === "modify_mail") {
      counts.modify += 1;
      continue;
    }

    if (call.name === "list_linear_issue_metadata") {
      counts.linearMetadata += 1;
      continue;
    }

    if (call.name === "create_linear_issue") {
      counts.linearCreate += 1;
    }
  }

  if (pendingCount > 0) {
    const active = items.find((item) => item.pending);
    if (active?.call.name === "search_gmail") {
      const query = parseToolArguments(active.call.arguments).query;
      return typeof query === "string" && query.trim()
        ? `Searching "${truncateToolDetail(query)}"`
        : "Searching mail";
    }

    if (active?.call.name === "read_gmail_thread") {
      return "Reading thread";
    }

    if (active?.call.name === "read_gmail_message" || active?.call.name === "read_gmail_messages") {
      return active.call.name === "read_gmail_messages" ? "Reading messages" : "Reading message";
    }

    if (active?.call.name === "read_gmail_attachment") {
      return "Reading attachment";
    }

    if (active?.call.name === "compose_email") {
      return "Drafting email";
    }

    if (active?.call.name === "create_google_calendar_event") {
      return "Adding calendar event";
    }

    if (active?.call.name === "list_linear_issue_metadata") {
      return "Reading Linear workspace";
    }

    if (active?.call.name === "create_linear_issue") {
      return "Creating Linear issue";
    }

    return "Working";
  }

  const parts: string[] = [];

  if (counts.search > 0) {
    parts.push(counts.search === 1 ? "searched mail" : `searched mail ${counts.search}×`);
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
    parts.push(counts.compose === 1 ? "drafted email" : `drafted ${counts.compose} emails`);
  }

  if (counts.calendar > 0) {
    parts.push(
      counts.calendar === 1 ? "added calendar event" : `added ${counts.calendar} calendar events`,
    );
  }

  if (counts.linearMetadata > 0) {
    parts.push("checked Linear");
  }

  if (counts.linearCreate > 0) {
    parts.push(
      counts.linearCreate === 1
        ? "created Linear issue"
        : `created ${counts.linearCreate} Linear issues`,
    );
  }

  if (parts.length === 0) {
    return `${items.length} step${items.length === 1 ? "" : "s"}`;
  }

  return parts.join(", ");
};

export const getActiveToolDetail = (call: ToolCall, result?: ToolResult): string | undefined => {
  const args = parseToolArguments(call.arguments);
  const parsed = parseToolResult(call.name, result?.content ?? "");

  if (call.name === "search_gmail" && typeof args.query === "string") {
    return truncateToolDetail(args.query);
  }

  if (call.name === "read_gmail_thread") {
    if (parsed.kind === "gmail-thread" && parsed.data.status === "success" && parsed.data.subject) {
      return truncateToolDetail(parsed.data.subject);
    }

    return typeof args.threadId === "string" ? truncateToolDetail(args.threadId, 16) : undefined;
  }

  if (call.name === "read_gmail_message") {
    if (
      parsed.kind === "gmail-message" &&
      parsed.data.status === "success" &&
      parsed.data.subject
    ) {
      return truncateToolDetail(parsed.data.subject);
    }
  }

  if (call.name === "read_gmail_messages") {
    const messageIds = args.messageIds;
    return Array.isArray(messageIds) ? countLabel(messageIds.length, "message") : undefined;
  }

  if (call.name === "read_gmail_attachment") {
    if (
      parsed.kind === "gmail-attachment" &&
      parsed.data.status === "success" &&
      parsed.data.fileName
    ) {
      return truncateToolDetail(parsed.data.fileName);
    }

    return undefined;
  }

  if (call.name === "compose_email" && typeof args.subject === "string" && args.subject.trim()) {
    return truncateToolDetail(args.subject);
  }

  if (call.name === "create_google_calendar_event") {
    if (
      parsed.kind === "google-calendar-event" &&
      parsed.data.status === "success" &&
      parsed.data.summary
    ) {
      return truncateToolDetail(parsed.data.summary);
    }

    return typeof args.summary === "string" ? truncateToolDetail(args.summary) : undefined;
  }

  if (call.name === "list_linear_issue_metadata") {
    if (parsed.kind === "linear-issue-metadata" && parsed.data.status === "success") {
      return countLabel(parsed.data.teams.length, "team");
    }
  }

  if (call.name === "create_linear_issue") {
    if (
      parsed.kind === "linear-issue-create" &&
      parsed.data.status === "success" &&
      parsed.data.title
    ) {
      return truncateToolDetail(parsed.data.title);
    }

    return typeof args.title === "string" ? truncateToolDetail(args.title) : undefined;
  }

  return undefined;
};

export const shouldUngroupTool = (call: ToolCall) => call.name === "compose_email";
