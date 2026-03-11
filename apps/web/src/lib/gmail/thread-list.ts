import { isMessageUnread, type MessageListItem } from "./gmail";
import { parseSender } from "./message-utils";

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
  participants: ThreadParticipant[];
  subject: string;
  preview: string;
  messageCount: number;
  unreadCount: number;
};

const buildParticipant = (message: MessageListItem): ThreadParticipant => {
  const sender = parseSender(message.from);
  const label = sender.name || sender.email || sender.display || "Unknown sender";

  return {
    label,
    email: sender.email || undefined,
    avatarUrlLight: message.senderAvatarUrls?.light,
    avatarUrlDark: message.senderAvatarUrls?.dark,
    fallbackLabel: (label.trim().charAt(0) || "?").toUpperCase(),
  };
};

const getParticipantKey = (participant: ThreadParticipant): string => {
  return participant.email ?? participant.label.toLowerCase();
};

export const buildThreadListEntries = (messages: readonly MessageListItem[]): ThreadListEntry[] => {
  const orderedThreads: ThreadListEntry[] = [];
  const threadsById = new Map<string, ThreadListEntry>();

  for (const message of messages) {
    const existingThread = threadsById.get(message.threadId);

    if (!existingThread) {
      const participant = buildParticipant(message);
      const nextThread: ThreadListEntry = {
        threadId: message.threadId,
        anchorMessage: message,
        messages: [message],
        participants: [participant],
        subject: message.subject?.trim() || "(No subject)",
        preview: message.snippet?.trim() || "",
        messageCount: 1,
        unreadCount: isMessageUnread(message) ? 1 : 0,
      };

      threadsById.set(message.threadId, nextThread);
      orderedThreads.push(nextThread);
      continue;
    }

    existingThread.messages.push(message);
    existingThread.messageCount += 1;

    if (!existingThread.preview && message.snippet?.trim()) {
      existingThread.preview = message.snippet.trim();
    }

    if (existingThread.subject === "(No subject)" && message.subject?.trim()) {
      existingThread.subject = message.subject.trim();
    }

    if (isMessageUnread(message)) {
      existingThread.unreadCount += 1;
    }

    const participant = buildParticipant(message);
    const participantKey = getParticipantKey(participant);
    const hasParticipant = existingThread.participants.some(
      (currentParticipant) => getParticipantKey(currentParticipant) === participantKey,
    );

    if (!hasParticipant) {
      existingThread.participants.push(participant);
    }
  }

  return orderedThreads;
};
