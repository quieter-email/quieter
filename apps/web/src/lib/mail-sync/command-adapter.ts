import type { MailboxCategory, MessageListItem } from "@quieter/mail/messages";
import type { SyncChange, SyncCommand } from "@quieter/sync";

import { getMailCommandUpdater } from "#/lib/gmail/inbox-query/data";
import { isMessageInMailbox } from "#/lib/mail";

export const overlaySyncMessage = (
  mailboxId: string,
  message: MessageListItem,
  commands: Iterable<SyncCommand>,
  entities?: ReadonlyMap<string, SyncChange>
): MessageListItem | null => {
  let result =
    entities === undefined
      ? message
      : {
          ...message,
          labelIds: message.labelIds?.filter(
            (id) => entities.get(`label:${id}`)?.data !== null
          ),
          threadLabelIds: message.threadLabelIds?.filter(
            (id) => entities.get(`label:${id}`)?.data !== null
          ),
        };
  for (const command of commands) {
    if (
      command.mailboxId !== mailboxId ||
      !command.targets.some(
        (target) =>
          target.threadId === message.threadId &&
          target.messageIds.includes(message.id)
      )
    ) {
      continue;
    }
    if (command.command.kind === "delete-permanently") {
      return null;
    }
    result = getMailCommandUpdater(command.command)(result);
  }
  return result;
};

export const summarizeSyncThread = ({
  mailboxId,
  threadId,
  entities,
  commands,
  category,
  fallback,
}: {
  mailboxId: string;
  threadId: string;
  entities: ReadonlyMap<string, SyncChange> | undefined;
  commands: readonly SyncCommand[];
  category?: MailboxCategory;
  fallback?: MessageListItem;
}): MessageListItem | null => {
  const entity = entities?.get(`thread:${threadId}`);
  if (entity?.data === null) {
    return null;
  }
  const thread = entity?.data?.kind === "thread" ? entity.data.value : null;
  const messages = thread?.messageIds.flatMap((id) => {
    const message = entities?.get(`message:${id}`)?.data;
    return message?.kind === "message" ? [message.value] : [];
  });
  if (thread !== null && messages?.length === thread.messageCount) {
    const projected = messages.flatMap((message) => {
      const next = overlaySyncMessage(mailboxId, message, commands, entities);
      return next === null ? [] : [next];
    });
    const visible =
      category === undefined
        ? projected
        : projected.filter((message) => isMessageInMailbox(message, category));
    const latest = visible.at(-1);
    if (latest === undefined) {
      return null;
    }
    return {
      ...latest,
      isUnread: visible.some((message) => message.isUnread === true),
      threadAttachmentCount: projected.reduce(
        (count, message) => count + (message.attachments?.length ?? 0),
        0
      ),
      threadLabelIds: [
        ...new Set(projected.flatMap((message) => message.labelIds ?? [])),
      ],
      threadMessageCount: projected.length,
    };
  }
  const base =
    thread === null
      ? fallback
      : {
          ...thread.latest,
          isUnread: thread.isUnread,
          threadAttachmentCount: thread.attachmentCount,
          threadLabelIds: thread.labelIds,
          threadMessageCount: thread.messageCount,
        };
  if (base === undefined) {
    return null;
  }
  // Partial coverage cannot prove that a single-message action changed every message.
  const wholeThreadCommands = commands.filter((command) =>
    command.targets.some(
      (target) =>
        target.threadId === threadId &&
        target.messageIds.length >= (base.threadMessageCount ?? 1)
    )
  );
  const result = overlaySyncMessage(
    mailboxId,
    base,
    wholeThreadCommands,
    entities
  );
  return result !== null &&
    (category === undefined || isMessageInMailbox(result, category))
    ? result
    : null;
};
