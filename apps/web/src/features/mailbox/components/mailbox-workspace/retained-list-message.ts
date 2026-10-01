import { getThreadLabelIds } from "#/lib/gmail/thread-list";
import type { ListMessagesPageResult, MessageListItem } from "#/lib/mail";
import { mergeMessagePreservingLoadedDetails } from "#/lib/mail/inbox-query/data";

export type RetainedListMessage = {
  scopeKey: string;
  message: MessageListItem;
  pageIndex: number;
  messageIndex: number;
  precedingMessageId: string | undefined;
  followingMessageId: string | undefined;
};

export const captureListMessage = (
  pages: ListMessagesPageResult[],
  scopeKey: string,
  messageId: string
): RetainedListMessage | null => {
  for (const [pageIndex, page] of pages.entries()) {
    const messageIndex = page.messages.findIndex(
      (message) => message.id === messageId
    );
    if (messageIndex !== -1) {
      return {
        followingMessageId:
          page.messages[messageIndex + 1]?.id ??
          pages[pageIndex + 1]?.messages[0]?.id,
        message: page.messages[messageIndex],
        messageIndex,
        pageIndex,
        precedingMessageId:
          messageIndex > 0
            ? page.messages[messageIndex - 1].id
            : pages[pageIndex - 1]?.messages.at(-1)?.id,
        scopeKey,
      };
    }
  }
  return null;
};

export const retainSelectedMessageInList = ({
  pages,
  retainedMessage,
  scopeKey,
  messageId,
  selectedMessage,
  selectedThreadMessages,
}: {
  pages: ListMessagesPageResult[];
  retainedMessage: RetainedListMessage | null;
  scopeKey: string;
  messageId: string | null;
  selectedMessage: MessageListItem | null;
  selectedThreadMessages: MessageListItem[] | undefined;
}): ListMessagesPageResult[] => {
  if (
    retainedMessage === null ||
    retainedMessage.scopeKey !== scopeKey ||
    retainedMessage.message.id !== messageId ||
    pages.some((page) =>
      page.messages.some(
        (message) => message.threadId === retainedMessage.message.threadId
      )
    )
  ) {
    return pages;
  }

  const message = selectedMessage
    ? mergeMessagePreservingLoadedDetails(
        retainedMessage.message,
        selectedMessage
      )
    : retainedMessage.message;
  const followingMessage = captureListMessage(
    pages,
    scopeKey,
    retainedMessage.followingMessageId ?? ""
  );
  const precedingMessage = captureListMessage(
    pages,
    scopeKey,
    retainedMessage.precedingMessageId ?? ""
  );
  const pageIndex =
    followingMessage?.pageIndex ??
    precedingMessage?.pageIndex ??
    Math.min(retainedMessage.pageIndex, Math.max(pages.length - 1, 0));
  const page = pages[pageIndex] ?? { messages: [] };
  const messages = [...page.messages];
  const messageIndex =
    followingMessage?.messageIndex ??
    (precedingMessage
      ? precedingMessage.messageIndex + 1
      : Math.min(retainedMessage.messageIndex, messages.length));
  messages.splice(messageIndex, 0, {
    ...message,
    threadLabelIds: selectedThreadMessages
      ? getThreadLabelIds(selectedThreadMessages)
      : message.threadLabelIds,
  });
  const nextPages = [...pages];
  nextPages[pageIndex] = { ...page, messages };
  return nextPages;
};
