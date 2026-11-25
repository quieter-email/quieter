import {
  isMessageInMailbox,
  isMessageUnread,
  MAILBOX_LABELS,
} from "@quieter/app/lib/mail";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import type { MessagesQueryData } from "@quieter/app/lib/mail/inbox-query/data";
import { getMessageSortTimestamp } from "@quieter/app/lib/mail/inbox-query/data";
import { getCachedMessagesQueries } from "@quieter/app/lib/mail/inbox-query/query-cache";
import type {
  MailSearchFilter,
  StructuredMailSearch,
} from "@quieter/mail/search";
import { parseStructuredSearchQuery } from "@quieter/mail/search";
import type { QueryClient } from "@tanstack/react-query";

const MAX_PROVISIONAL_MESSAGES = 15;

const includesNormalized = (source: string | null | undefined, value: string) =>
  (source ?? "").toLocaleLowerCase().includes(value.toLocaleLowerCase());

const getMessageSearchText = (message: MessageListItem) =>
  [
    message.subject,
    message.from,
    message.to,
    message.cc,
    message.bcc,
    message.snippet,
    message.bodyText,
  ]
    .filter((value): value is string => (value ?? "") !== "")
    .join(" ")
    .toLocaleLowerCase();

const hasAttachment = (message: MessageListItem) =>
  (message.threadAttachmentCount ?? message.attachments?.length ?? 0) > 0 ||
  (message.threadAttachmentNames?.length ?? 0) > 0;

const hasAttachmentName = (message: MessageListItem, value: string) => {
  const normalized = value.toLocaleLowerCase();
  return (
    message.threadAttachmentNames?.some((name) =>
      name.toLocaleLowerCase().includes(normalized)
    ) === true ||
    message.attachments?.some((attachment) =>
      attachment.fileName.toLocaleLowerCase().includes(normalized)
    ) === true
  );
};

const messageMatchesFilter = (
  message: MessageListItem,
  filter: MailSearchFilter
): boolean | null => {
  let matches: boolean;
  switch (filter.type) {
    case "from": {
      matches = includesNormalized(message.from, filter.value);
      break;
    }
    case "to": {
      matches = includesNormalized(message.to, filter.value);
      break;
    }
    case "cc": {
      matches = includesNormalized(message.cc, filter.value);
      break;
    }
    case "bcc": {
      matches = includesNormalized(message.bcc, filter.value);
      break;
    }
    case "subject": {
      matches = includesNormalized(message.subject, filter.value);
      break;
    }
    case "filename": {
      matches = hasAttachmentName(message, filter.value);
      break;
    }
    case "has": {
      if (filter.value.trim().toLocaleLowerCase() !== "attachment") {
        return null;
      }
      matches = hasAttachment(message);
      break;
    }
    case "is": {
      const state = filter.value.trim().toLocaleLowerCase();
      if (state === "unread") {
        matches = isMessageUnread(message);
        break;
      }
      if (state === "read") {
        matches = !isMessageUnread(message);
        break;
      }
      return null;
    }
    case "after":
    case "before":
    case "content":
    case "header":
    case "label":
    case "newer_than":
    case "older_than": {
      return null;
    }
    default: {
      return null;
    }
  }

  return filter.negated === true ? !matches : matches;
};

const messageMatchesSearch = (
  message: MessageListItem,
  search: StructuredMailSearch
): boolean | null => {
  if (search.text !== "") {
    const text = getMessageSearchText(message);
    const terms = search.text
      .toLocaleLowerCase()
      .split(/\s+/u)
      .filter((term) => term !== "");
    if (!terms.every((term) => text.includes(term))) {
      return false;
    }
  }
  for (const filter of search.filters) {
    const matches = messageMatchesFilter(message, filter);
    if (matches === null || !matches) {
      return matches;
    }
  }
  return true;
};

const messageIsInCategory = (
  message: MessageListItem,
  category: MailboxCategory
) => {
  if (category === "unread") {
    return (
      isMessageUnread(message) &&
      message.labelIds?.includes(MAILBOX_LABELS.spam) !== true &&
      message.labelIds?.includes(MAILBOX_LABELS.trash) !== true
    );
  }
  return isMessageInMailbox(message, category);
};

export const getProvisionalMessagesData = (
  queryClient: QueryClient,
  mailboxId: string,
  category: MailboxCategory,
  searchQuery?: string | null
): MessagesQueryData | undefined => {
  // Later order and membership depend on the server's schedules.
  if (category === "drafts" || category === "later") {
    return undefined;
  }
  const normalizedSearch = searchQuery?.trim() ?? "";
  const search =
    normalizedSearch === ""
      ? null
      : parseStructuredSearchQuery(normalizedSearch);
  const messagesById = new Map<string, MessageListItem>();
  const cachedQueries = getCachedMessagesQueries(queryClient, mailboxId);
  // Done hides a whole conversation while any of it is in Inbox or snoozed.
  const excludedThreadIds = new Set(
    category === "done"
      ? cachedQueries.flatMap((cachedQuery) =>
          (cachedQuery.data?.pages ?? []).flatMap((page) =>
            page.messages.flatMap((message) =>
              isMessageInMailbox(message, "inbox") ||
              message.threadLabelIds?.includes(MAILBOX_LABELS.inbox) === true ||
              isMessageInMailbox(message, "later")
                ? [message.threadId]
                : []
            )
          )
        )
      : []
  );

  for (const cachedQuery of cachedQueries) {
    for (const page of cachedQuery.data?.pages ?? []) {
      for (const message of page.messages) {
        if (
          excludedThreadIds.has(message.threadId) ||
          !messageIsInCategory(message, category)
        ) {
          continue;
        }
        if (search !== null && messageMatchesSearch(message, search) !== true) {
          continue;
        }
        const current = messagesById.get(message.id);
        if (
          current === undefined ||
          getMessageSortTimestamp(message) > getMessageSortTimestamp(current)
        ) {
          messagesById.set(message.id, message);
        }
      }
    }
  }

  if (messagesById.size === 0) {
    return undefined;
  }

  return {
    pageParams: [undefined],
    pages: [
      {
        messages: [...messagesById.values()]
          .toSorted(
            (left, right) =>
              getMessageSortTimestamp(right) - getMessageSortTimestamp(left)
          )
          .slice(0, MAX_PROVISIONAL_MESSAGES),
      },
    ],
  };
};
