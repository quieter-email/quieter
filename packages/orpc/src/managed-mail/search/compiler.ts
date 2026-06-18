import {
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database";
import {
  normalizeStructuredMailSearch,
  type MailSearchFilter,
  type StructuredMailSearch,
} from "@quieter/mail/search";
import { and, eq, exists, ilike, not, or, sql, type SQL } from "drizzle-orm";
import { normalizeManagedSearchValue, parseAbsoluteDate, parseRelativeDate } from "./normalization";

const createContainsPattern = (value: string) => `%${value.replace(/[%_\\]/g, "\\$&")}%`;

const createFilterCondition = (
  mailboxId: string,
  filter: MailSearchFilter,
  now: Date,
): SQL | undefined => {
  const value = filter.value.trim();
  const normalizedValue = normalizeManagedSearchValue(value);
  let condition: SQL | undefined;

  switch (filter.type) {
    case "from":
      condition = ilike(managedMailMessage.fromNormalized, createContainsPattern(normalizedValue));
      break;
    case "to":
      condition = ilike(managedMailMessage.toNormalized, createContainsPattern(normalizedValue));
      break;
    case "cc":
      condition = ilike(managedMailMessage.ccNormalized, createContainsPattern(normalizedValue));
      break;
    case "bcc":
      condition = ilike(managedMailMessage.bccNormalized, createContainsPattern(normalizedValue));
      break;
    case "subject":
      condition = ilike(managedMailMessage.subject, createContainsPattern(value));
      break;
    case "content":
      condition = ilike(managedMailMessage.bodyText, createContainsPattern(value));
      break;
    case "filename":
      condition = exists(
        sql`select 1 from ${managedMailAttachment}
            where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
              and ${managedMailAttachment.normalizedFileName}
                like ${createContainsPattern(normalizedValue)}`,
      );
      break;
    case "has":
      if (value === "attachment") {
        condition = exists(
          sql`select 1 from ${managedMailAttachment}
              where ${managedMailAttachment.messageId} = ${managedMailMessage.id}`,
        );
      }
      break;
    case "label":
      condition = exists(
        sql`select 1
            from ${managedMailMessageLabel}
            inner join ${managedMailLabel}
              on ${managedMailLabel.id} = ${managedMailMessageLabel.labelId}
            where ${managedMailMessageLabel.messageId} = ${managedMailMessage.id}
              and ${managedMailMessageLabel.mailboxId} = ${mailboxId}
              and ${managedMailLabel.normalizedName} = ${normalizedValue}`,
      );
      break;
    case "is":
      if (value === "read" || value === "unread") {
        condition = eq(managedMailMessage.isRead, value === "read");
      } else if (value === "inbound" || value === "outbound") {
        condition = eq(managedMailMessage.direction, value);
      }
      break;
    case "after":
    case "before": {
      const date = parseAbsoluteDate(value);
      if (date) {
        condition =
          filter.type === "before"
            ? sql`${managedMailMessage.sentAt} < ${date}`
            : sql`${managedMailMessage.sentAt} >= ${date}`;
      }
      break;
    }
    case "newer_than":
    case "older_than": {
      const date = parseRelativeDate(value, now);
      if (date) {
        condition =
          filter.type === "older_than"
            ? sql`${managedMailMessage.sentAt} < ${date}`
            : sql`${managedMailMessage.sentAt} >= ${date}`;
      }
      break;
    }
  }

  return condition && filter.negated ? not(condition) : condition;
};

const createTextCondition = (text: string) =>
  or(
    sql`to_tsvector('simple', ${managedMailMessage.searchText})
        @@ websearch_to_tsquery('simple', ${text})`,
    ilike(managedMailMessage.searchText, createContainsPattern(text)),
    exists(
      sql`select 1 from ${managedMailAttachment}
          where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
            and ${managedMailAttachment.normalizedFileName}
              like ${createContainsPattern(normalizeManagedSearchValue(text))}`,
    ),
  )!;

export const createManagedSearchCondition = (
  mailboxId: string,
  search: StructuredMailSearch,
  now = new Date(),
  matchMode: "all" | "any" = "all",
) => {
  const normalizedSearch = normalizeStructuredMailSearch(search);
  if (matchMode === "any") {
    const conditions = normalizedSearch.filters
      .map((filter) => createFilterCondition(mailboxId, filter, now))
      .filter((condition): condition is SQL => !!condition);
    if (normalizedSearch.text) conditions.push(createTextCondition(normalizedSearch.text));
    return conditions.length > 0 ? or(...conditions) : undefined;
  }

  const groupedFilters = new Map<MailSearchFilter["type"], MailSearchFilter[]>();
  for (const filter of normalizedSearch.filters) {
    const filters = groupedFilters.get(filter.type) ?? [];
    filters.push(filter);
    groupedFilters.set(filter.type, filters);
  }

  const conditions: SQL[] = [];
  for (const filters of groupedFilters.values()) {
    const groupConditions = filters
      .map((filter) => createFilterCondition(mailboxId, filter, now))
      .filter((condition): condition is SQL => !!condition);
    const groupCondition =
      groupConditions.length === 1 ? groupConditions[0] : or(...groupConditions);
    if (groupCondition) conditions.push(groupCondition);
  }

  if (normalizedSearch.text) conditions.push(createTextCondition(normalizedSearch.text));
  return conditions.length > 0 ? and(...conditions) : undefined;
};
