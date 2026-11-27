import type { MailboxSyncDelta, MessageListItem } from "@quieter/mail/messages";

import { readMailboxChanges } from "../mailbox-changes";
import { listManagedMessages } from "../managed-mail/messages/service";
import { attachScheduledSendMetadata } from "../scheduled-send/sent-metadata";
import {
  attachMailSnoozeStates,
  filterMailSnoozeVisibility,
} from "../snooze/queries";
import type { MailInputs } from "./inputs";

export const projectManagedMailboxRows = async (input: {
  category: MailInputs["listThreads"]["category"];
  mailboxId: string;
  messages: MessageListItem[];
  organizationId: string | null;
  userId: string;
}) => {
  const { category, mailboxId, organizationId, userId } = input;
  const messages = await attachMailSnoozeStates({
    mailboxId,
    messages: input.messages,
    userId,
  });
  const visible = await filterMailSnoozeVisibility({
    category,
    mailboxId,
    threadIds: messages.map((message) => message.threadId),
    userId,
  });
  const filtered = messages.filter((message) => visible.has(message.threadId));
  return category === "sent" && organizationId !== null
    ? await attachScheduledSendMetadata({
        mailboxId,
        messages: filtered,
        source: { organizationId, provider: "managed" },
        userId,
      })
    : filtered;
};

export const replayManagedMailbox = async ({
  contentRevision,
  headVersion,
  input,
  organizationId,
  userId,
}: {
  contentRevision: number;
  headVersion?: bigint;
  input: MailInputs["syncMailbox"];
  organizationId: string | null;
  userId: string;
}): Promise<MailboxSyncDelta> => {
  const historyId = String(contentRevision);
  const { category, mailboxId, startChangeVersion, startHistoryId } = input;
  const fallback: MailboxSyncDelta = {
    hasChanges: true,
    historyId,
    refreshFirstPage: true,
    removedMessageIds: [],
    requiresFullRefresh: true,
    updatedMessages: [],
  };
  if (startChangeVersion === undefined || headVersion === undefined) {
    return historyId === startHistoryId
      ? {
          ...fallback,
          hasChanges: false,
          refreshFirstPage: false,
          requiresFullRefresh: false,
        }
      : fallback;
  }
  const previous = Number(startHistoryId);
  if (
    !Number.isSafeInteger(previous) ||
    String(previous) !== startHistoryId ||
    previous < 0
  ) {
    return fallback;
  }
  const replay = await readMailboxChanges({
    afterVersion: startChangeVersion,
    headVersion,
    mailboxId,
    userId,
  });
  if (
    replay === null ||
    replay.contentRevisions.length !== contentRevision - previous ||
    replay.contentRevisions.some(
      (revision, index) => revision !== previous + index + 1
    )
  ) {
    return fallback;
  }

  const affectedThreads = new Set<string>();
  const removedMessages = new Set<string>();
  for (const change of replay.changes) {
    if (change.kind === "verification-code.available") {
      continue;
    }
    if (!("threadId" in change) || change.threadId === undefined) {
      return fallback;
    }
    affectedThreads.add(change.threadId);
    if (change.kind === "message.deleted") {
      removedMessages.add(change.messageId);
    } else if (change.kind === "message.added") {
      removedMessages.delete(change.messageId);
    }
  }

  const threadIds = [...affectedThreads];
  const page =
    threadIds.length > 0
      ? await listManagedMessages({
          category,
          mailboxId,
          maxResults: threadIds.length,
          threadIds,
          userId,
        })
      : null;
  const messages =
    page === null
      ? []
      : await projectManagedMailboxRows({
          category,
          mailboxId,
          messages: page.messages,
          organizationId,
          userId,
        });
  return {
    changeVersion: String(headVersion),
    hasChanges: threadIds.length > 0,
    historyId,
    refreshFirstPage: false,
    refreshThreadIds: threadIds,
    removedMessageIds: [...removedMessages],
    replacedThreadIds: threadIds,
    requiresFullRefresh: false,
    updatedMessages: messages,
  };
};
