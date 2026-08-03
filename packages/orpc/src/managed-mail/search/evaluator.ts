import { managedMailAttachment, managedMailMessage } from "@quieter/database/schema";
import {
  normalizeStructuredMailSearch,
  type MailSearchFilter,
  type StructuredMailSearch,
} from "@quieter/mail/search";
import { normalizeManagedSearchValue, parseAbsoluteDate, parseRelativeDate } from "./normalization";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;

const includesNormalized = (source: string | null | undefined, value: string) =>
  normalizeManagedSearchValue(source).includes(normalizeManagedSearchValue(value));

const matchesFilter = (
  message: ManagedMessageRecord,
  attachments: readonly ManagedAttachmentRecord[],
  filter: MailSearchFilter,
  customLabelIds: readonly string[] | undefined,
  customLabelNames: readonly string[] | undefined,
  now: Date,
) => {
  const value = filter.value.trim();
  let matches = false;

  switch (filter.type) {
    case "from":
      matches = includesNormalized(message.from, value);
      break;
    case "to":
      matches = includesNormalized(message.to, value);
      break;
    case "cc":
      matches = includesNormalized(message.cc, value);
      break;
    case "bcc":
      matches = includesNormalized(message.bcc, value);
      break;
    case "header": {
      const separator = value.indexOf(":");
      if (separator <= 0) break;
      const headerName = normalizeManagedSearchValue(value.slice(0, separator));
      const headerValue = value.slice(separator + 1).trim();
      matches = message.headers.some(
        (header) =>
          normalizeManagedSearchValue(header.name) === headerName &&
          normalizeManagedSearchValue(header.value).includes(
            normalizeManagedSearchValue(headerValue),
          ),
      );
      break;
    }
    case "subject":
      matches = includesNormalized(message.subject, value);
      break;
    case "content":
      matches = includesNormalized(message.bodyText, value);
      break;
    case "filename":
      matches = attachments.some((attachment) =>
        attachment.normalizedFileName.includes(normalizeManagedSearchValue(value)),
      );
      break;
    case "has":
      matches = value === "attachment" && attachments.length > 0;
      break;
    case "is":
      matches =
        (value === "read" && message.isRead) ||
        (value === "unread" && !message.isRead) ||
        value === message.direction ||
        (value === "spam" && message.mailboxState === "spam") ||
        (value === "trash" && message.mailboxState === "trash") ||
        (value === "inbox" &&
          message.direction === "inbound" &&
          message.mailboxState === "active") ||
        (value === "sent" && message.direction === "outbound" && message.mailboxState === "active");
      break;
    case "after":
    case "before": {
      const date = parseAbsoluteDate(value);
      matches =
        !!date && (filter.type === "before" ? message.sentAt < date : message.sentAt >= date);
      break;
    }
    case "newer_than":
    case "older_than": {
      const date = parseRelativeDate(value, now);
      matches =
        !!date && (filter.type === "older_than" ? message.sentAt < date : message.sentAt >= date);
      break;
    }
    case "label":
      matches = [...(customLabelIds ?? []), ...(customLabelNames ?? [])].some(
        (label) => normalizeManagedSearchValue(label) === normalizeManagedSearchValue(value),
      );
      break;
  }

  return filter.negated ? !matches : matches;
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
      now,
    ),
  );

  if (search.text) results.push(includesNormalized(input.message.searchText, search.text));
  if (results.length === 0) return false;
  return input.matchMode === "all" ? results.every(Boolean) : results.some(Boolean);
};
