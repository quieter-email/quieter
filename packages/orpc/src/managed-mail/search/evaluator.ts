import type {
  managedMailAttachment,
  managedMailMessage,
} from "@quieter/database/schema";
import { normalizeStructuredMailSearch } from "@quieter/mail/search";
import type {
  MailSearchFilter,
  StructuredMailSearch,
} from "@quieter/mail/search";

import { hasText } from "../../text";
import {
  normalizeManagedSearchValue,
  parseAbsoluteDate,
  parseRelativeDate,
} from "./normalization";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;

const includesNormalized = (source: string | null | undefined, value: string) =>
  normalizeManagedSearchValue(source).includes(
    normalizeManagedSearchValue(value)
  );

const matchesHeaderFilter = (
  message: ManagedMessageRecord,
  filter: MailSearchFilter
) => {
  const value = filter.value.trim();
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return false;
  }
  const headerName = normalizeManagedSearchValue(value.slice(0, separator));
  const headerValue = value.slice(separator + 1).trim();
  if (!hasText(headerName) || !hasText(headerValue)) {
    return false;
  }
  return message.headers.some(
    (header) =>
      normalizeManagedSearchValue(header.name) === headerName &&
      normalizeManagedSearchValue(header.value).includes(
        normalizeManagedSearchValue(headerValue)
      )
  );
};

const matchesIsFilter = (
  message: ManagedMessageRecord,
  filter: MailSearchFilter
) => {
  const value = filter.value.trim();
  if (value === "read") {
    return message.isRead;
  }
  if (value === "unread") {
    return !message.isRead;
  }
  if (value === message.direction) {
    return true;
  }
  if (value === "spam") {
    return message.mailboxState === "spam";
  }
  if (value === "trash") {
    return message.mailboxState === "trash";
  }
  if (value === "inbox") {
    return message.direction === "inbound" && message.mailboxState === "active";
  }
  if (value === "sent") {
    return (
      message.direction === "outbound" && message.mailboxState === "active"
    );
  }
  return false;
};

const matchesDateFilter = (
  message: ManagedMessageRecord,
  filter: MailSearchFilter,
  now: Date
) => {
  const value = filter.value.trim();
  if (filter.type === "after" || filter.type === "before") {
    const date = parseAbsoluteDate(value);
    if (date === null) {
      return false;
    }
    if (filter.type === "before") {
      return message.sentAt < date;
    }
    return message.sentAt >= date;
  }

  const date = parseRelativeDate(value, now);
  if (date === null) {
    return false;
  }
  if (filter.type === "older_than") {
    return message.sentAt < date;
  }
  return message.sentAt >= date;
};

const matchesLabelFilter = (
  filter: MailSearchFilter,
  customLabelIds: readonly string[] | undefined,
  customLabelNames: readonly string[] | undefined
) =>
  [...(customLabelIds ?? []), ...(customLabelNames ?? [])].some(
    (label) =>
      normalizeManagedSearchValue(label) ===
      normalizeManagedSearchValue(filter.value.trim())
  );

const matchesFilter = (
  message: ManagedMessageRecord,
  attachments: readonly ManagedAttachmentRecord[],
  filter: MailSearchFilter,
  customLabelIds: readonly string[] | undefined,
  customLabelNames: readonly string[] | undefined,
  now: Date
) => {
  const value = filter.value.trim();
  let matches = false;

  switch (filter.type) {
    case "from": {
      matches = includesNormalized(message.from, value);
      break;
    }
    case "to": {
      matches = includesNormalized(message.to, value);
      break;
    }
    case "cc": {
      matches = includesNormalized(message.cc, value);
      break;
    }
    case "bcc": {
      matches = includesNormalized(message.bcc, value);
      break;
    }
    case "header": {
      matches = matchesHeaderFilter(message, filter);
      break;
    }
    case "subject": {
      matches = includesNormalized(message.subject, value);
      break;
    }
    case "content": {
      matches = includesNormalized(message.bodyText, value);
      break;
    }
    case "filename": {
      matches = attachments.some((attachment) =>
        attachment.normalizedFileName.includes(
          normalizeManagedSearchValue(value)
        )
      );
      break;
    }
    case "has": {
      matches = value === "attachment" && attachments.length > 0;
      break;
    }
    case "is": {
      matches = matchesIsFilter(message, filter);
      break;
    }
    case "after":
    case "before":
    case "newer_than":
    case "older_than": {
      matches = matchesDateFilter(message, filter, now);
      break;
    }
    case "label": {
      matches = matchesLabelFilter(filter, customLabelIds, customLabelNames);
      break;
    }
    default: {
      matches = false;
      break;
    }
  }

  if (filter.negated === true) {
    return !matches;
  }
  return matches;
};

export const matchesManagedMailRule = (input: {
  attachments: readonly ManagedAttachmentRecord[];
  customLabelIds?: readonly string[];
  customLabelNames?: readonly string[];
  matchMode: "all" | "any";
  message: ManagedMessageRecord;
  now?: Date;
  search: StructuredMailSearch;
}) => {
  const search = normalizeStructuredMailSearch(input.search);
  const now = input.now ?? new Date();
  const results = search.filters.map((filter) =>
    matchesFilter(
      input.message,
      input.attachments,
      filter,
      input.customLabelIds,
      input.customLabelNames,
      now
    )
  );

  if (hasText(search.text)) {
    results.push(includesNormalized(input.message.searchText, search.text));
  }
  if (results.length === 0) {
    return false;
  }
  return input.matchMode === "all"
    ? results.every(Boolean)
    : results.some(Boolean);
};
