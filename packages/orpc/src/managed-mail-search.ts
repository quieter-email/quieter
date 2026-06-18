import {
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database";
import {
  normalizeStructuredMailSearch,
  parseStructuredSearchQuery,
  type MailSearchFilter,
  type StructuredMailSearch,
} from "@quieter/mail/search";
import { and, eq, exists, ilike, not, or, sql, type SQL } from "drizzle-orm";

type ManagedMessageRecord = typeof managedMailMessage.$inferSelect;
type ManagedAttachmentRecord = Pick<
  typeof managedMailAttachment.$inferSelect,
  "fileName" | "normalizedFileName"
>;

export const normalizeManagedSearchValue = (value: string | null | undefined) =>
  value?.replace(/\s+/g, " ").trim().toLocaleLowerCase() ?? "";

export const createManagedMessageSearchText = (input: {
  bodyText?: string | null;
  snippet?: string | null;
  subject?: string | null;
}) =>
  [input.subject, input.snippet, input.bodyText]
    .map((value) => value?.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");

const parseAbsoluteDate = (value: string) => {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

const parseRelativeDate = (value: string, now: Date) => {
  const match = /^(\d+)([dmy])$/i.exec(value.trim());
  if (!match) return null;

  const amount = Number(match[1]);
  const date = new Date(now);
  if (match[2].toLocaleLowerCase() === "d") {
    date.setDate(date.getDate() - amount);
  } else if (match[2].toLocaleLowerCase() === "m") {
    date.setMonth(date.getMonth() - amount);
  } else {
    date.setFullYear(date.getFullYear() - amount);
  }
  return date;
};

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
      condition = ilike(managedMailMessage.fromNormalized, `%${normalizedValue}%`);
      break;
    case "to":
      condition = ilike(managedMailMessage.toNormalized, `%${normalizedValue}%`);
      break;
    case "cc":
      condition = ilike(managedMailMessage.ccNormalized, `%${normalizedValue}%`);
      break;
    case "bcc":
      condition = ilike(managedMailMessage.bccNormalized, `%${normalizedValue}%`);
      break;
    case "subject":
      condition = ilike(managedMailMessage.subject, `%${value}%`);
      break;
    case "content":
      condition = ilike(managedMailMessage.bodyText, `%${value}%`);
      break;
    case "filename":
      condition = exists(
        sql`select 1 from ${managedMailAttachment}
            where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
              and ${managedMailAttachment.normalizedFileName} like ${`%${normalizedValue}%`}`,
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
        if (filter.type === "before") {
          condition = sql`${managedMailMessage.sentAt} < ${date}`;
        } else {
          condition = sql`${managedMailMessage.sentAt} >= ${date}`;
        }
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
    if (normalizedSearch.text) {
      conditions.push(
        or(
          sql`to_tsvector('simple', ${managedMailMessage.searchText})
              @@ websearch_to_tsquery('simple', ${normalizedSearch.text})`,
          ilike(managedMailMessage.searchText, `%${normalizedSearch.text}%`),
          exists(
            sql`select 1 from ${managedMailAttachment}
                where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
                  and ${managedMailAttachment.normalizedFileName}
                    like ${`%${normalizeManagedSearchValue(normalizedSearch.text)}%`}`,
          ),
        )!,
      );
    }
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

  if (normalizedSearch.text) {
    conditions.push(
      or(
        sql`to_tsvector('simple', ${managedMailMessage.searchText})
            @@ websearch_to_tsquery('simple', ${normalizedSearch.text})`,
        ilike(managedMailMessage.searchText, `%${normalizedSearch.text}%`),
        exists(
          sql`select 1 from ${managedMailAttachment}
              where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
                and ${managedMailAttachment.normalizedFileName}
                  like ${`%${normalizeManagedSearchValue(normalizedSearch.text)}%`}`,
        ),
      )!,
    );
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
};

const includesNormalized = (source: string | null | undefined, value: string) =>
  normalizeManagedSearchValue(source).includes(normalizeManagedSearchValue(value));

const matchesFilter = (
  message: ManagedMessageRecord,
  attachments: readonly ManagedAttachmentRecord[],
  filter: MailSearchFilter,
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
        value === message.direction;
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
      matches = false;
      break;
  }

  return filter.negated ? !matches : matches;
};

export const matchesManagedMailRule = (input: {
  attachments: readonly ManagedAttachmentRecord[];
  matchMode: "all" | "any";
  message: ManagedMessageRecord;
  search: StructuredMailSearch;
}) => {
  const search = normalizeStructuredMailSearch(input.search);
  const results = search.filters
    .filter((filter) => filter.type !== "label")
    .map((filter) => matchesFilter(input.message, input.attachments, filter, new Date()));

  if (search.text) {
    results.push(includesNormalized(input.message.searchText, search.text));
  }

  if (results.length === 0) return false;
  return input.matchMode === "all" ? results.every(Boolean) : results.some(Boolean);
};

export const parseManagedSearchQuery = (query: string | undefined) =>
  parseStructuredSearchQuery(query?.trim() ?? "");

export const assertManagedRuleSearch = (search: StructuredMailSearch) => {
  const unsupported = search.filters.find((filter) =>
    ["label", "after", "before", "newer_than", "older_than"].includes(filter.type),
  );
  if (unsupported) {
    throw new Error(`The ${unsupported.type} filter is not supported in automatic rules.`);
  }
  return normalizeStructuredMailSearch(search);
};
