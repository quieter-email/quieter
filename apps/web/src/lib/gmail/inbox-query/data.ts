import type { MailCommand } from "@quieter/mail/data-plane";

import {
  addUnreadLabel,
  MAILBOX_LABELS,
  applyLabelIdChanges,
  isMessageUnread,
  removeUnreadLabel,
} from "#/lib/mail";
import type {
  ListMessagesPageResult,
  MessageListItem,
  ThreadMessagesResult,
} from "#/lib/mail";

export type MessagesQueryData = {
  pages: ListMessagesPageResult[];
  pageParams: (string | undefined)[];
};

type MergeRefreshedMailboxPagesOptions = {
  preserveUnrefreshedPages?: boolean;
};

export type LabelChangeSet = {
  addLabelIds?: readonly string[];
  removeLabelIds?: readonly string[];
};

export const isMessagesQueryData = (
  value: unknown
): value is MessagesQueryData => {
  if (!(typeof value === "object" && value !== null)) {
    return false;
  }

  return (
    "pages" in value &&
    Array.isArray(value.pages) &&
    "pageParams" in value &&
    Array.isArray(value.pageParams)
  );
};

const buildCachedMessageLookup = (
  data: MessagesQueryData | undefined,
  pageCount = data?.pages.length ?? 0
) => {
  const messagesById = new Map<string, MessageListItem>();

  for (const page of data?.pages.slice(0, pageCount) ?? []) {
    for (const message of page.messages) {
      messagesById.set(message.id, message);
    }
  }

  return messagesById;
};

export const mergeMessagePreservingLoadedDetails = (
  currentMessage: MessageListItem,
  syncedMessage: MessageListItem
): MessageListItem => ({
  ...syncedMessage,
  attachments: syncedMessage.attachments ?? currentMessage.attachments,
  bodyHtml: syncedMessage.bodyHtml ?? currentMessage.bodyHtml,
  bodyText: syncedMessage.bodyText ?? currentMessage.bodyText,
  draftAnchor: syncedMessage.draftAnchor ?? currentMessage.draftAnchor,
  draftId: syncedMessage.draftId ?? currentMessage.draftId,
  senderAvatarUrls:
    syncedMessage.senderAvatarUrls ?? currentMessage.senderAvatarUrls,
  threadAttachmentCount:
    syncedMessage.threadAttachmentCount ?? currentMessage.threadAttachmentCount,
  threadMessageCount:
    syncedMessage.threadMessageCount ?? currentMessage.threadMessageCount,
  unsubscribeMailto:
    syncedMessage.unsubscribeMailto ?? currentMessage.unsubscribeMailto,
  unsubscribeUrl: syncedMessage.unsubscribeUrl ?? currentMessage.unsubscribeUrl,
});

export const mergeRefreshedMailboxPagesIntoQueryData = (
  previous: MessagesQueryData | undefined,
  refreshedPages: ListMessagesPageResult[],
  refreshedPageParams: (string | undefined)[],
  options: MergeRefreshedMailboxPagesOptions = {}
): MessagesQueryData => {
  if (previous === undefined || previous.pages.length === 0) {
    return { pageParams: refreshedPageParams, pages: refreshedPages };
  }

  const cachedById = buildCachedMessageLookup(
    previous,
    options.preserveUnrefreshedPages === true
      ? Math.min(previous.pages.length, refreshedPages.length + 1)
      : previous.pages.length
  );
  const pages = refreshedPages.map((page) => ({
    ...page,
    messages: page.messages.map((message) => {
      const previousMessage = cachedById.get(message.id);
      return previousMessage
        ? mergeMessagePreservingLoadedDetails(previousMessage, message)
        : message;
    }),
  }));
  const lastRefreshedPage = refreshedPages.at(-1);

  if (
    options.preserveUnrefreshedPages !== true ||
    lastRefreshedPage?.nextPageToken === null ||
    lastRefreshedPage?.nextPageToken === undefined ||
    lastRefreshedPage.nextPageToken === "" ||
    refreshedPages.length >= previous.pages.length
  ) {
    return { pageParams: refreshedPageParams, pages };
  }

  const refreshedMessageIds = new Set(
    pages.flatMap((page) => page.messages.map((message) => message.id))
  );
  const preservedPages = previous.pages
    .slice(refreshedPages.length)
    .map((page) => ({
      ...page,
      messages: page.messages.filter(
        (message) => !refreshedMessageIds.has(message.id)
      ),
    }));

  return {
    pageParams: [
      ...refreshedPageParams,
      ...previous.pageParams.slice(refreshedPageParams.length),
    ],
    pages: [...pages, ...preservedPages],
  };
};

export const updateMessagesInQueryData = (
  data: MessagesQueryData | undefined,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem
): MessagesQueryData | undefined => {
  if (!data) {
    return data;
  }

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const messages = page.messages.map((message) => {
      if (!predicate(message)) {
        return message;
      }

      const nextMessage = updater(message);
      if (nextMessage === message) {
        return message;
      }

      hasChanges = true;
      pageChanged = true;
      return nextMessage;
    });

    return pageChanged ? { ...page, messages } : page;
  });

  return hasChanges ? { ...data, pages } : data;
};

export const updateMessageInQueryData = (
  data: MessagesQueryData | undefined,
  messageId: string,
  updater: (message: MessageListItem) => MessageListItem
) =>
  updateMessagesInQueryData(
    data,
    (message) => message.id === messageId,
    updater
  );

export const findMessageInQueryData = (
  data: MessagesQueryData | undefined,
  messageId: string
) => {
  for (const page of data?.pages ?? []) {
    for (const message of page.messages) {
      if (message.id === messageId) {
        return message;
      }
    }
  }

  return undefined;
};

export const removeMessagesFromQueryData = (
  data: MessagesQueryData | undefined,
  predicate: (message: MessageListItem) => boolean
): MessagesQueryData | undefined => {
  if (!data) {
    return data;
  }

  let hasChanges = false;
  const pages = data.pages.map((page) => {
    const messages = page.messages.filter((message) => !predicate(message));
    if (messages.length === page.messages.length) {
      return page;
    }

    hasChanges = true;
    return { ...page, messages };
  });

  return hasChanges ? { ...data, pages } : data;
};

export const updateMessageInThreadData = (
  data: ThreadMessagesResult | undefined,
  messageId: string,
  updater: (message: MessageListItem) => MessageListItem
): ThreadMessagesResult | undefined =>
  updateMessagesInThreadData(
    data,
    (message) => message.id === messageId,
    updater
  );

export const updateMessagesInThreadData = (
  data: ThreadMessagesResult | undefined,
  predicate: (message: MessageListItem) => boolean,
  updater: (message: MessageListItem) => MessageListItem
): ThreadMessagesResult | undefined => {
  if (!data) {
    return data;
  }

  let hasChanges = false;
  const messages = data.messages.map((message) => {
    if (!predicate(message)) {
      return message;
    }

    const nextMessage = updater(message);
    if (nextMessage === message) {
      return message;
    }

    hasChanges = true;
    return nextMessage;
  });

  return hasChanges ? { ...data, messages } : data;
};

export const upsertMessageInThreadData = (
  data: ThreadMessagesResult | undefined,
  nextMessage: MessageListItem
): ThreadMessagesResult | undefined => {
  if (!data || data.threadId !== nextMessage.threadId) {
    return data;
  }

  const currentIndex = data.messages.findIndex(
    (message) => message.id === nextMessage.id
  );
  if (currentIndex !== -1) {
    return updateMessageInThreadData(data, nextMessage.id, (message) =>
      mergeMessagePreservingLoadedDetails(message, nextMessage)
    );
  }

  const messageOrder = new Map(
    data.messages.map((message, index) => [message.id, index])
  );
  const messages = [...data.messages, nextMessage].toSorted((left, right) => {
    const timestampDifference =
      getMessageSortTimestamp(left) - getMessageSortTimestamp(right);
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    const leftOrder = messageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = messageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });

  return { ...data, messages };
};

export const removeMessagesFromThreadData = (
  data: ThreadMessagesResult | undefined,
  predicate: (message: MessageListItem) => boolean
): ThreadMessagesResult | undefined => {
  if (!data) {
    return data;
  }

  const messages = data.messages.filter((message) => !predicate(message));
  return messages.length === data.messages.length
    ? data
    : { ...data, messages };
};

export const markMessageReadLocally = (
  message: MessageListItem
): MessageListItem => {
  if (!isMessageUnread(message)) {
    return message;
  }
  return {
    ...message,
    isUnread: false,
    labelIds: removeUnreadLabel(message.labelIds),
  };
};

export const markMessageUnreadLocally = (
  message: MessageListItem
): MessageListItem => {
  if (isMessageUnread(message)) {
    return message;
  }
  return {
    ...message,
    isUnread: true,
    labelIds: addUnreadLabel(message.labelIds),
  };
};

const areLabelIdsEquivalent = (
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
) => {
  const leftLength = left?.length ?? 0;
  const rightLength = right?.length ?? 0;
  if (leftLength === 0 && rightLength === 0) {
    return true;
  }
  if (left === undefined || right === undefined || leftLength !== rightLength) {
    return false;
  }

  const rightSet = new Set(right);
  for (const labelId of left) {
    if (!rightSet.has(labelId)) {
      return false;
    }
  }

  return true;
};

export const applyMessageMetadata = (
  message: MessageListItem,
  next: { labelIds?: string[]; isUnread: boolean; threadLabelIds?: string[] }
): MessageListItem => {
  const threadLabelIds = next.threadLabelIds ?? message.threadLabelIds;
  if (
    message.isUnread === next.isUnread &&
    areLabelIdsEquivalent(message.labelIds, next.labelIds) &&
    areLabelIdsEquivalent(message.threadLabelIds, threadLabelIds)
  ) {
    return message;
  }

  return {
    ...message,
    isUnread: next.isUnread,
    labelIds: next.labelIds,
    threadLabelIds,
  };
};

export const applyMessageLabelChangesLocally = (
  message: MessageListItem,
  changes: LabelChangeSet
) => {
  const labelIds = applyLabelIdChanges(message.labelIds, changes);
  return applyMessageMetadata(message, {
    isUnread: isMessageUnread({ labelIds }),
    labelIds,
  });
};

export const applyThreadLabelChangesLocally = (
  message: MessageListItem,
  changes: LabelChangeSet
) => {
  const labelIds = applyLabelIdChanges(message.labelIds, changes);
  const threadLabelIds = applyLabelIdChanges(
    message.threadLabelIds ?? message.labelIds,
    changes
  );
  return applyMessageMetadata(message, {
    isUnread: isMessageUnread({ labelIds }),
    labelIds,
    threadLabelIds,
  });
};

const getMessageSortTimestamp = (
  message: Pick<MessageListItem, "date" | "internalDate">
): number => {
  const source = message.internalDate ?? message.date;
  if (source === null || source === undefined || source === "") {
    return 0;
  }

  const numeric = Number(source);
  const parsedDate = Number.isFinite(numeric)
    ? new Date(numeric)
    : new Date(source);
  const timestamp = parsedDate.getTime();

  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const mergeSyncedMessages = (
  currentMessages: readonly MessageListItem[],
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[]
) => {
  const updatedMessagesById = new Map(
    updatedMessages.map((message) => [message.id, message] as const)
  );
  const removedMessageIdsSet = new Set(removedMessageIds);
  const nextMessages = currentMessages.flatMap((message) => {
    if (removedMessageIdsSet.has(message.id)) {
      return [];
    }

    const synced = updatedMessagesById.get(message.id);
    return [
      synced ? mergeMessagePreservingLoadedDetails(message, synced) : message,
    ];
  });
  const nextMessageIds = new Set(nextMessages.map((message) => message.id));
  const currentThreadIds = new Set(
    currentMessages.map((message) => message.threadId)
  );
  const oldestLoadedMessage = currentMessages.at(-1);
  const oldestLoadedTimestamp = oldestLoadedMessage
    ? getMessageSortTimestamp(oldestLoadedMessage)
    : Number.NEGATIVE_INFINITY;

  for (const updatedMessage of updatedMessages) {
    if (
      !nextMessageIds.has(updatedMessage.id) &&
      (!currentMessages.length ||
        currentThreadIds.has(updatedMessage.threadId) ||
        getMessageSortTimestamp(updatedMessage) >= oldestLoadedTimestamp)
    ) {
      nextMessages.push(updatedMessage);
      nextMessageIds.add(updatedMessage.id);
    }
  }

  return nextMessages;
};

const sortMessages = (
  messages: MessageListItem[],
  currentMessages: readonly MessageListItem[]
) => {
  const currentMessageOrder = new Map(
    currentMessages.map((message, index) => [message.id, index] as const)
  );

  messages.sort((left, right) => {
    const timestampDifference =
      getMessageSortTimestamp(right) - getMessageSortTimestamp(left);
    if (timestampDifference !== 0) {
      return timestampDifference;
    }

    const leftOrder =
      currentMessageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder =
      currentMessageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
};

const paginateMessages = (
  data: MessagesQueryData,
  messages: MessageListItem[]
): ListMessagesPageResult[] => {
  const pages: ListMessagesPageResult[] = [];
  let messageIndex = 0;

  for (const [pageIndex, page] of data.pages.entries()) {
    const remainingMessageCount = messages.length - messageIndex;
    if (pageIndex > 0 && remainingMessageCount <= 0) {
      break;
    }

    const basePageSize =
      page.messages.length > 0 || pageIndex > 0
        ? page.messages.length
        : remainingMessageCount;
    const pageSize =
      pageIndex === data.pages.length - 1
        ? Math.max(basePageSize, remainingMessageCount)
        : basePageSize;
    const pageMessages = messages.slice(messageIndex, messageIndex + pageSize);

    pages.push({ ...page, messages: pageMessages });
    messageIndex += pageMessages.length;
  }

  if (pages.length === 0) {
    pages.push({ ...data.pages[0], messages: [] });
  }

  return pages;
};

export const applySyncDeltaToQueryData = (
  data: MessagesQueryData | undefined,
  updatedMessages: readonly MessageListItem[],
  removedMessageIds: readonly string[]
): MessagesQueryData | undefined => {
  if (data === undefined || data.pages.length === 0) {
    return data;
  }

  const currentMessages = data.pages.flatMap((page) => page.messages);
  if (
    !currentMessages.length &&
    !updatedMessages.length &&
    !removedMessageIds.length
  ) {
    return data;
  }

  const nextMessages = mergeSyncedMessages(
    currentMessages,
    updatedMessages,
    removedMessageIds
  );
  sortMessages(nextMessages, currentMessages);
  const nextPages = paginateMessages(data, nextMessages);

  return {
    ...data,
    pageParams: data.pageParams.slice(0, nextPages.length),
    pages: nextPages,
  };
};

export const getMailCommandUpdater =
  (command: MailCommand) => (message: MessageListItem) => {
    if (command.kind === "set-read") {
      return command.read
        ? markMessageReadLocally(message)
        : markMessageUnreadLocally(message);
    }
    if (command.kind === "set-labels") {
      return applyMessageLabelChangesLocally(message, {
        addLabelIds: command.addIds,
        removeLabelIds: command.removeIds,
      });
    }
    if (command.kind === "delete-permanently") {
      return message;
    }
    if (command.destination === "archive") {
      return applyMessageLabelChangesLocally(message, {
        removeLabelIds: [MAILBOX_LABELS.inbox],
      });
    }
    if (command.destination === "spam") {
      return applyMessageLabelChangesLocally(message, {
        addLabelIds: [MAILBOX_LABELS.spam],
        removeLabelIds: [MAILBOX_LABELS.inbox],
      });
    }
    if (command.destination === "trash") {
      return applyMessageLabelChangesLocally(message, {
        addLabelIds: [MAILBOX_LABELS.trash],
        removeLabelIds: [
          MAILBOX_LABELS.inbox,
          MAILBOX_LABELS.spam,
          MAILBOX_LABELS.sent,
          MAILBOX_LABELS.drafts,
        ],
      });
    }
    return applyMessageLabelChangesLocally(message, {
      addLabelIds: [MAILBOX_LABELS.inbox],
      removeLabelIds: [
        MAILBOX_LABELS.archive,
        MAILBOX_LABELS.spam,
        MAILBOX_LABELS.trash,
      ],
    });
  };
