import { isMessageUnread } from "./messages";
import type { MessageListItem } from "./messages";
import { extractSenderEmail } from "./sender-avatar";

const compactMessageDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const fullMessageDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "long",
  timeStyle: "short",
});
const messageListTimeFormatter = new Intl.DateTimeFormat(undefined, {
  timeStyle: "short",
});
const messageListCurrentYearDateFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
});
const messageListPreviousYearDateFormatter = new Intl.DateTimeFormat(
  undefined,
  {
    day: "numeric",
    month: "short",
    year: "numeric",
  }
);

type MessageDateSource = {
  date?: string;
  internalDate?: string;
};

const getParsedMessageDate = (message: MessageDateSource) => {
  const source = message.internalDate ?? message.date;
  if (!source) {
    return null;
  }

  const numeric = Number(source);
  const parsed = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatMessageDate = (
  message: MessageDateSource,
  format: "compact" | "full"
): string => {
  const parsed = getParsedMessageDate(message);
  if (parsed === null) {
    return "";
  }

  return (
    format === "compact"
      ? compactMessageDateFormatter
      : fullMessageDateFormatter
  ).format(parsed);
};

export const formatMessageListDate = (
  message: MessageDateSource,
  referenceDate = new Date()
): string => {
  const parsed = getParsedMessageDate(message);
  if (!parsed) {
    return "";
  }

  const isCurrentYear = parsed.getFullYear() === referenceDate.getFullYear();
  const isToday =
    isCurrentYear &&
    parsed.getMonth() === referenceDate.getMonth() &&
    parsed.getDate() === referenceDate.getDate();

  if (isToday) {
    return messageListTimeFormatter.format(parsed);
  }

  return (
    isCurrentYear
      ? messageListCurrentYearDateFormatter
      : messageListPreviousYearDateFormatter
  ).format(parsed);
};

export type ParsedSender = {
  display: string;
  email: string;
  name: string;
};

export const parseSender = (from?: string): ParsedSender => {
  if (!from) {
    return { display: "", email: "", name: "" };
  }

  const display = from.trim();
  const email = extractSenderEmail(display) ?? "";
  const bracketMatch = /^(?<name>.*?)<\s*[^<>@\s]+@[^<>@\s]+\s*>/u.exec(
    display
  );
  const rawNameSource =
    bracketMatch?.groups?.name ??
    (email ? display.replace(email, "") : display);
  const rawName = rawNameSource
    .replaceAll('"', "")
    .replaceAll(/[<>]/gu, "")
    .trim();
  const name = rawName && rawName !== email ? rawName : "";

  return { display, email, name };
};

export type ThreadParticipant = {
  label: string;
  email?: string;
  avatarUrlLight?: string;
  avatarUrlDark?: string;
  fallbackLabel: string;
};

export type ThreadListEntry = {
  threadId: string;
  anchorMessage: MessageListItem;
  messages: MessageListItem[];
  threadLabelIds: string[];
  participants: ThreadParticipant[];
  subject: string;
  preview: string;
  messageCount: number;
  attachmentCount: number;
  unreadCount: number;
};

const buildParticipant = (message: MessageListItem): ThreadParticipant => {
  const sender = parseSender(message.from);
  const label =
    sender.name || sender.email || sender.display || "Unknown sender";

  return {
    avatarUrlDark: message.senderAvatarUrls?.dark,
    avatarUrlLight: message.senderAvatarUrls?.light,
    email: sender.email || undefined,
    fallbackLabel: (label.trim().charAt(0) || "?").toUpperCase(),
    label,
  };
};

const getParticipantKey = (participant: ThreadParticipant): string =>
  participant.email ?? participant.label.toLowerCase();

export const getThreadLabelIds = (
  messages: readonly { labelIds?: string[]; threadLabelIds?: string[] }[]
): string[] => [
  ...new Set(
    messages.flatMap(
      (message) => message.threadLabelIds ?? message.labelIds ?? []
    )
  ),
];

const createThreadEntry = (message: MessageListItem): ThreadListEntry => {
  const participant = buildParticipant(message);
  const preview = message.snippet?.trim();
  const subject = message.subject?.trim();

  return {
    anchorMessage: message,
    attachmentCount:
      message.threadAttachmentCount ?? message.attachments?.length ?? 0,
    messageCount: Math.max(1, message.threadMessageCount ?? 0),
    messages: [message],
    participants: [participant],
    preview: preview ?? "",
    subject: subject === undefined || subject === "" ? "(No subject)" : subject,
    threadId: message.threadId,
    threadLabelIds: getThreadLabelIds([message]),
    unreadCount: isMessageUnread(message) ? 1 : 0,
  };
};

const updateThreadEntry = (
  existingThread: ThreadListEntry,
  message: MessageListItem
) => {
  existingThread.messages.push(message);
  existingThread.threadLabelIds = getThreadLabelIds(existingThread.messages);
  existingThread.messageCount = Math.max(
    existingThread.messageCount,
    existingThread.messages.length,
    message.threadMessageCount ?? 0
  );
  existingThread.attachmentCount =
    message.threadAttachmentCount ??
    existingThread.attachmentCount + (message.attachments?.length ?? 0);

  const snippet = message.snippet?.trim();
  if (
    existingThread.preview === "" &&
    snippet !== undefined &&
    snippet !== ""
  ) {
    existingThread.preview = snippet;
  }

  const subject = message.subject?.trim();
  if (
    existingThread.subject === "(No subject)" &&
    subject !== undefined &&
    subject !== ""
  ) {
    existingThread.subject = subject;
  }

  if (isMessageUnread(message)) {
    existingThread.unreadCount += 1;
  }

  const participant = buildParticipant(message);
  const participantKey = getParticipantKey(participant);
  const hasParticipant = existingThread.participants.some(
    (currentParticipant) =>
      getParticipantKey(currentParticipant) === participantKey
  );
  if (!hasParticipant) {
    existingThread.participants.push(participant);
  }
};

export const buildThreadListEntries = (
  messages: readonly MessageListItem[]
): ThreadListEntry[] => {
  const orderedThreads: ThreadListEntry[] = [];
  const threadsById = new Map<string, ThreadListEntry>();

  for (const message of messages) {
    const existingThread = threadsById.get(message.threadId);

    if (!existingThread) {
      const nextThread = createThreadEntry(message);

      threadsById.set(message.threadId, nextThread);
      orderedThreads.push(nextThread);
      continue;
    }

    updateThreadEntry(existingThread, message);
  }

  return orderedThreads;
};
