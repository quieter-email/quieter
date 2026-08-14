import { isMessageUnread } from "./gmail";
import type { MessageListItem } from "./gmail";
import { parseSender } from "./message-utils";

type ThreadParticipant = {
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
