import { parseStructuredSearchQuery } from "@quieter/mail/search";

import {
  isMessageInMailbox,
  isMessageUnread,
  MAILBOX_LABELS,
} from "#/lib/mail";
import type {
  ListMessagesPageResult,
  MailboxCategory,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";

export const listDemoMail = (
  messages: MessageListItem[],
  input: {
    category: MailboxCategory;
    historyId: string;
    labels: readonly { id: string; name: string }[];
    maxResults?: number;
    pageToken?: string;
    query?: string;
  }
): ListMessagesPageResult => {
  const search = parseStructuredSearchQuery(input.query ?? "");
  const labels = new Map(
    input.labels.flatMap((label) => [
      [label.id.toLowerCase(), label.id],
      [label.name.toLowerCase(), label.id],
    ])
  );
  const now = Date.now();
  const matching = messages.filter((message) => {
    if (!isMessageInMailbox(message, input.category)) {
      return false;
    }
    const text = [
      message.subject,
      message.from,
      message.to,
      message.snippet,
      message.bodyText,
    ]
      .join(" ")
      .toLowerCase();
    if (!text.includes(search.text.toLowerCase())) {
      return false;
    }
    return search.filters.every((filter) => {
      const value = filter.value.toLowerCase();
      const timestamp = new Date(
        message.internalDate ?? message.date ?? 0
      ).getTime();
      let matched = false;
      // oxlint-disable-next-line default-case -- The typed filter union is exhaustively checked.
      switch (filter.type) {
        case "after":
        case "before": {
          const boundary = new Date(filter.value).getTime();
          matched =
            filter.type === "after"
              ? timestamp > boundary
              : timestamp < boundary;
          break;
        }
        case "older_than":
        case "newer_than": {
          const duration = /^(?<amount>\d+)(?<unit>[dmy])$/u.exec(
            value
          )?.groups;
          if (duration !== undefined) {
            const days: Record<string, number> = { d: 1, m: 30, y: 365 };
            const boundary =
              now - Number(duration.amount) * days[duration.unit] * 86_400_000;
            matched =
              filter.type === "older_than"
                ? timestamp < boundary
                : timestamp >= boundary;
          }
          break;
        }
        case "has": {
          matched =
            value === "attachment" && (message.attachments?.length ?? 0) > 0;
          break;
        }
        case "is": {
          const flags: Record<string, boolean> = {
            read: !isMessageUnread(message),
            spam: message.labelIds?.includes(MAILBOX_LABELS.spam) ?? false,
            trash: message.labelIds?.includes(MAILBOX_LABELS.trash) ?? false,
            unread: isMessageUnread(message),
          };
          matched = flags[value] ?? false;
          break;
        }
        case "label": {
          matched =
            message.labelIds?.includes(labels.get(value) ?? "") ?? false;
          break;
        }
        case "header": {
          return false;
        }
        case "bcc":
        case "cc":
        case "content":
        case "filename":
        case "from":
        case "subject":
        case "to": {
          const fields: Record<string, (string | null | undefined)[]> = {
            bcc: [message.bcc],
            cc: [message.cc],
            content: [message.bodyText, message.snippet],
            filename:
              message.attachments?.map((attachment) => attachment.fileName) ??
              [],
            from: [message.from],
            subject: [message.subject],
            to: [message.to],
          };
          matched =
            fields[filter.type]?.some(
              (field) => field?.toLowerCase().includes(value) ?? false
            ) ?? false;
        }
      }
      return filter.negated === true ? !matched : matched;
    });
  });
  const threadLabels = new Map<string, Set<string>>();
  for (const message of messages) {
    const labelsForThread =
      threadLabels.get(message.threadId) ?? new Set<string>();
    for (const id of message.labelIds ?? []) {
      labelsForThread.add(id);
    }
    threadLabels.set(message.threadId, labelsForThread);
  }
  const offset = Number(input.pageToken ?? 0);
  const start = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const limit = Math.min(100, Math.max(1, input.maxResults ?? 50));
  const page = matching.slice(start, start + limit).map((message) => ({
    ...message,
    threadLabelIds: [...(threadLabels.get(message.threadId) ?? [])],
  }));
  return {
    historyId: input.historyId,
    messages: page,
    nextPageToken:
      start + limit < matching.length ? String(start + limit) : undefined,
    resultSizeEstimate: matching.length,
  };
};

export const getDemoMailThread = (
  messages: MessageListItem[],
  threadId: string
): ThreadMessagesResult => {
  const thread = messages.filter((message) => message.threadId === threadId);
  const threadLabelIds = [
    ...new Set(thread.flatMap((message) => message.labelIds ?? [])),
  ];
  return {
    messages: thread.map((message) => ({ ...message, threadLabelIds })),
    snippet: thread[0]?.snippet,
    subject: thread[0]?.subject,
    threadId,
  };
};
