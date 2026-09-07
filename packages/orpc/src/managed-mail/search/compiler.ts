import { ORPCError } from "@orpc/server";
import {
  managedMailAttachment,
  managedMailLabel,
  managedMailMessage,
  managedMailMessageLabel,
} from "@quieter/database/schema";
import { normalizeStructuredMailSearch } from "@quieter/mail/search";
import type {
  MailSearchFilter,
  StructuredMailSearch,
} from "@quieter/mail/search";
import { and, eq, exists, ilike, not, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { hasText } from "../../text";
import {
  normalizeManagedSearchValue,
  parseAbsoluteDate,
  parseRelativeDate,
} from "./normalization";

const createContainsPattern = (value: string) =>
  `%${value.replaceAll(/[%_\\]/gu, "\\$&")}%`;

const createAddressFilterCondition = (
  filter: MailSearchFilter,
  column: typeof managedMailMessage.fromNormalized
) => {
  const value = filter.value.trim();
  return ilike(
    sql`coalesce(${column}, '')`,
    createContainsPattern(normalizeManagedSearchValue(value))
  );
};

const createHeaderFilterCondition = (
  filter: MailSearchFilter
): SQL | undefined => {
  const value = filter.value.trim();
  const separator = value.indexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const headerName = normalizeManagedSearchValue(value.slice(0, separator));
  const headerValue = value.slice(separator + 1).trim();
  if (!hasText(headerName) || !hasText(headerValue)) {
    return undefined;
  }
  return exists(
    sql`select 1
        from jsonb_array_elements(${managedMailMessage.headers}) as header
        where regexp_replace(lower(trim(header->>'name')), '[[:space:]]+', ' ', 'g') = ${headerName}
          and regexp_replace(lower(trim(header->>'value')), '[[:space:]]+', ' ', 'g') like ${createContainsPattern(normalizeManagedSearchValue(headerValue))}`
  );
};

const createFilenameFilterCondition = (filter: MailSearchFilter) => {
  const normalizedValue = normalizeManagedSearchValue(filter.value.trim());
  return exists(
    sql`select 1 from ${managedMailAttachment}
        where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
          and ${managedMailAttachment.normalizedFileName}
            like ${createContainsPattern(normalizedValue)}`
  );
};

const createLabelFilterCondition = (
  mailboxId: string,
  filter: MailSearchFilter
) => {
  const normalizedValue = normalizeManagedSearchValue(filter.value.trim());
  return exists(
    sql`select 1
        from ${managedMailMessageLabel}
        inner join ${managedMailLabel}
          on ${managedMailLabel.id} = ${managedMailMessageLabel.labelId}
        where ${managedMailMessageLabel.messageId} = ${managedMailMessage.id}
          and ${managedMailMessageLabel.mailboxId} = ${mailboxId}
          and (
            ${managedMailLabel.normalizedName} = ${normalizedValue}
            or lower(${managedMailLabel.id}) = ${normalizedValue}
          )`
  );
};

const createIsFilterCondition = (filter: MailSearchFilter): SQL | undefined => {
  const value = filter.value.trim();
  if (value === "read" || value === "unread") {
    return eq(managedMailMessage.isRead, value === "read");
  }
  if (value === "inbound" || value === "outbound") {
    return eq(managedMailMessage.direction, value);
  }
  if (value === "archived") {
    return eq(managedMailMessage.mailboxState, "archived");
  }
  if (value === "spam" || value === "trash") {
    return eq(managedMailMessage.mailboxState, value);
  }
  if (value === "inbox") {
    return and(
      eq(managedMailMessage.direction, "inbound"),
      eq(managedMailMessage.mailboxState, "active")
    );
  }
  if (value === "sent") {
    return and(
      eq(managedMailMessage.direction, "outbound"),
      eq(managedMailMessage.mailboxState, "active")
    );
  }
  return undefined;
};

const createDateFilterCondition = (
  filter: MailSearchFilter,
  now: Date
): SQL | undefined => {
  const value = filter.value.trim();
  if (filter.type === "after" || filter.type === "before") {
    const date = parseAbsoluteDate(value);
    if (date === null) {
      return undefined;
    }
    if (filter.type === "before") {
      return sql`${managedMailMessage.sentAt} < ${date}`;
    }
    return sql`${managedMailMessage.sentAt} >= ${date}`;
  }

  const date = parseRelativeDate(value, now);
  if (date === null) {
    return undefined;
  }
  if (filter.type === "older_than") {
    return sql`${managedMailMessage.sentAt} < ${date}`;
  }
  return sql`${managedMailMessage.sentAt} >= ${date}`;
};

const createFilterCondition = (
  mailboxId: string,
  filter: MailSearchFilter,
  now: Date
): SQL | undefined => {
  const value = filter.value.trim();
  let condition: SQL | undefined;

  switch (filter.type) {
    case "from": {
      condition = createAddressFilterCondition(
        filter,
        managedMailMessage.fromNormalized
      );
      break;
    }
    case "to": {
      condition = createAddressFilterCondition(
        filter,
        managedMailMessage.toNormalized
      );
      break;
    }
    case "cc": {
      condition = createAddressFilterCondition(
        filter,
        managedMailMessage.ccNormalized
      );
      break;
    }
    case "bcc": {
      condition = createAddressFilterCondition(
        filter,
        managedMailMessage.bccNormalized
      );
      break;
    }
    case "header": {
      condition = createHeaderFilterCondition(filter);
      break;
    }
    case "subject": {
      condition = ilike(
        sql`regexp_replace(lower(trim(coalesce(${managedMailMessage.subject}, ''))), '[[:space:]]+', ' ', 'g')`,
        createContainsPattern(normalizeManagedSearchValue(value))
      );
      break;
    }
    case "content": {
      condition = ilike(
        sql`regexp_replace(lower(trim(coalesce(${managedMailMessage.bodyText}, ''))), '[[:space:]]+', ' ', 'g')`,
        createContainsPattern(normalizeManagedSearchValue(value))
      );
      break;
    }
    case "filename": {
      condition = createFilenameFilterCondition(filter);
      break;
    }
    case "has": {
      if (value === "attachment") {
        condition = exists(
          sql`select 1 from ${managedMailAttachment}
              where ${managedMailAttachment.messageId} = ${managedMailMessage.id}`
        );
      }
      break;
    }
    case "label": {
      condition = createLabelFilterCondition(mailboxId, filter);
      break;
    }
    case "is": {
      condition = createIsFilterCondition(filter);
      break;
    }
    case "after":
    case "before":
    case "newer_than":
    case "older_than": {
      condition = createDateFilterCondition(filter, now);
      break;
    }
    default: {
      condition = undefined;
      break;
    }
  }

  if (condition === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This search contains an invalid filter value.",
    });
  }
  if (filter.negated === true) {
    return not(condition);
  }
  return condition;
};

const createTextCondition = (text: string, fullText: boolean) => {
  const conditions = [
    ilike(
      sql`regexp_replace(lower(trim(coalesce(${managedMailMessage.searchText}, ''))), '[[:space:]]+', ' ', 'g')`,
      createContainsPattern(normalizeManagedSearchValue(text))
    ),
    exists(
      sql`select 1 from ${managedMailAttachment}
          where ${managedMailAttachment.messageId} = ${managedMailMessage.id}
            and ${managedMailAttachment.normalizedFileName}
              like ${createContainsPattern(normalizeManagedSearchValue(text))}`
    ),
  ];
  if (fullText) {
    conditions.push(
      sql`to_tsvector('simple', ${managedMailMessage.searchText}) @@ websearch_to_tsquery('simple', ${text})`
    );
  }
  return or(...conditions);
};

export const createManagedSearchCondition = (
  mailboxId: string,
  search: StructuredMailSearch,
  options: { now?: Date; matchMode?: "all" | "any"; fullText?: boolean } = {}
) => {
  const { now = new Date(), matchMode = "all", fullText = true } = options;
  const normalizedSearch = normalizeStructuredMailSearch(search);
  const conditions = normalizedSearch.filters.map((filter) =>
    createFilterCondition(mailboxId, filter, now)
  );
  if (hasText(normalizedSearch.text)) {
    const textCondition = createTextCondition(normalizedSearch.text, fullText);
    if (textCondition !== undefined) {
      conditions.push(textCondition);
    }
  }
  return matchMode === "any" ? or(...conditions) : and(...conditions);
};
