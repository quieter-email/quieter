import { z } from "zod";

export const mailSearchFilterTypeSchema = z.enum([
  "after",
  "bcc",
  "before",
  "cc",
  "content",
  "filename",
  "from",
  "has",
  "is",
  "label",
  "newer_than",
  "older_than",
  "subject",
  "to",
]);

export type MailSearchFilterType = z.infer<typeof mailSearchFilterTypeSchema>;

export const mailSearchFilterSchema = z.object({
  negated: z.boolean().optional(),
  type: mailSearchFilterTypeSchema,
  value: z.string(),
});

export type MailSearchFilter = z.infer<typeof mailSearchFilterSchema>;

export const structuredMailSearchSchema = z.object({
  filters: z.array(mailSearchFilterSchema),
  text: z.string(),
});

export type StructuredMailSearch = z.infer<typeof structuredMailSearchSchema>;
export type MailboxProvider = "api" | "gmail" | "managed";

const GMAIL_FILTER_TYPES = new Set<MailSearchFilterType>([
  "after",
  "bcc",
  "before",
  "cc",
  "filename",
  "from",
  "has",
  "is",
  "label",
  "newer_than",
  "older_than",
  "to",
]);

const MANAGED_FILTER_TYPES = new Set<MailSearchFilterType>(mailSearchFilterTypeSchema.options);

const REPEATABLE_FILTER_TYPES = new Set<MailSearchFilterType>([
  "bcc",
  "cc",
  "content",
  "filename",
  "from",
  "label",
  "subject",
  "to",
]);

export const getSupportedMailSearchFilterTypes = (provider: MailboxProvider) =>
  provider === "managed" ? MANAGED_FILTER_TYPES : GMAIL_FILTER_TYPES;

export const isMailSearchFilterSupported = (
  provider: MailboxProvider,
  filter: Pick<MailSearchFilter, "type" | "value">,
) => {
  if (!getSupportedMailSearchFilterTypes(provider).has(filter.type)) {
    return false;
  }

  return !(
    provider === "gmail" &&
    filter.type === "is" &&
    !["read", "unread"].includes(filter.value.toLocaleLowerCase())
  );
};

export const isRepeatableMailSearchFilter = (type: MailSearchFilterType) =>
  REPEATABLE_FILTER_TYPES.has(type);

export const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();

const parseQuotedValue = (value: string) => {
  if (!value.startsWith('"') || !value.endsWith('"')) {
    return value;
  }

  let nextValue = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character === "\\" && index + 1 < value.length - 1) {
      nextValue += value[index + 1];
      index += 1;
      continue;
    }
    nextValue += character;
  }
  return nextValue;
};

const readStructuredToken = (query: string, start: number) => {
  let cursor = query[start] === "-" ? start + 1 : start;
  const typeStart = cursor;
  while (cursor < query.length && /[a-z_]/i.test(query[cursor] ?? "")) {
    cursor += 1;
  }

  if (cursor === typeStart || query[cursor] !== ":") {
    return null;
  }

  cursor += 1;
  if (cursor === query.length) {
    return query.slice(start, cursor);
  }

  if (query[cursor] === '"') {
    cursor += 1;
    while (cursor < query.length) {
      const character = query[cursor];
      if (character === "\\") {
        cursor += 2;
        continue;
      }
      cursor += 1;
      if (character === '"') {
        return query.slice(start, cursor);
      }
    }
    return null;
  }

  while (cursor < query.length && !/\s/.test(query[cursor] ?? "")) {
    cursor += 1;
  }
  return query.slice(start, cursor);
};

export const parseStructuredSearchFilterToken = (token: string): MailSearchFilter | null => {
  const negated = token.startsWith("-");
  const normalizedToken = negated ? token.slice(1) : token;
  const separatorIndex = normalizedToken.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const parsedType = mailSearchFilterTypeSchema.safeParse(
    normalizedToken.slice(0, separatorIndex).toLocaleLowerCase(),
  );
  if (!parsedType.success) {
    return null;
  }

  const type = parsedType.data;
  const withNegation = (filter: Omit<MailSearchFilter, "negated">): MailSearchFilter =>
    negated ? { ...filter, negated: true } : filter;
  const rawValue = normalizedToken.slice(separatorIndex + 1);
  if (rawValue.length === 0) {
    return ["has", "is", "label"].includes(type) ? null : withNegation({ type, value: "" });
  }

  const value = parseQuotedValue(rawValue).trim();
  if (!value) {
    return null;
  }

  if (type === "has") {
    return value.toLocaleLowerCase() === "attachment"
      ? withNegation({ type, value: "attachment" })
      : null;
  }

  if (type === "is") {
    const normalizedValue = value.toLocaleLowerCase();
    return ["inbox", "inbound", "outbound", "read", "sent", "spam", "trash", "unread"].includes(
      normalizedValue,
    )
      ? withNegation({ type, value: normalizedValue })
      : null;
  }

  return withNegation({ type, value });
};

export const serializeStructuredSearchFilterToken = ({
  negated,
  type,
  value,
}: MailSearchFilter) => {
  const normalizedValue = value.trim();
  const prefix = negated ? "-" : "";
  if (!normalizedValue) {
    return type === "label" ? "" : `${prefix}${type}:`;
  }

  const escapedValue = normalizedValue.replace(/(["\\])/g, "\\$1");
  const serializedValue = /[\s"\\]/.test(normalizedValue) ? `"${escapedValue}"` : normalizedValue;
  return `${prefix}${type}:${serializedValue}`;
};

type StructuredSearchQuerySegment =
  | { type: "text"; value: string }
  | { filter: MailSearchFilter; type: "filter" };

const tokenizeStructuredSearchQuery = (query: string): StructuredSearchQuerySegment[] => {
  const segments: StructuredSearchQuerySegment[] = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < query.length) {
    const isTokenStart = cursor === 0 || /\s/.test(query[cursor - 1] ?? "");
    if (!isTokenStart) {
      cursor += 1;
      continue;
    }

    const token = readStructuredToken(query, cursor);
    const filter = token && parseStructuredSearchFilterToken(token);
    if (!filter || !token) {
      cursor += 1;
      continue;
    }

    if (textStart < cursor) {
      segments.push({ type: "text", value: query.slice(textStart, cursor) });
    }
    segments.push({ filter, type: "filter" });
    cursor += token.length;
    textStart = cursor;
  }

  if (textStart < query.length) {
    segments.push({ type: "text", value: query.slice(textStart) });
  }

  return segments.length > 0 ? segments : [{ type: "text", value: query }];
};

const areEquivalentFilters = (left: MailSearchFilter, right: MailSearchFilter) =>
  left.type === right.type &&
  left.negated === right.negated &&
  normalizeSearchText(left.value).toLocaleLowerCase() ===
    normalizeSearchText(right.value).toLocaleLowerCase();

export const normalizeStructuredMailSearch = (
  search: StructuredMailSearch,
): StructuredMailSearch => {
  const filters: MailSearchFilter[] = [];
  for (const filter of search.filters) {
    const normalizedFilter = { ...filter, value: normalizeSearchText(filter.value) };
    if (
      normalizedFilter.value &&
      !filters.some((current) => areEquivalentFilters(current, normalizedFilter))
    ) {
      filters.push(normalizedFilter);
    }
  }

  return { filters, text: normalizeSearchText(search.text) };
};

export const parseStructuredSearchQuery = (query: string): StructuredMailSearch => {
  const filters: MailSearchFilter[] = [];
  const textParts: string[] = [];

  for (const segment of tokenizeStructuredSearchQuery(query)) {
    if (segment.type === "text") {
      textParts.push(segment.value);
      continue;
    }

    if (
      isRepeatableMailSearchFilter(segment.filter.type) ||
      !filters.some((filter) => filter.type === segment.filter.type)
    ) {
      filters.push(segment.filter);
      continue;
    }

    const existingIndex = filters.findIndex((filter) => filter.type === segment.filter.type);
    filters[existingIndex] = segment.filter;
  }

  return normalizeStructuredMailSearch({ filters, text: textParts.join("") });
};

export const serializeStructuredSearchState = (search: StructuredMailSearch) => {
  const normalized = normalizeStructuredMailSearch(search);
  return [...normalized.filters.map(serializeStructuredSearchFilterToken), normalized.text]
    .filter(Boolean)
    .join(" ")
    .trim();
};

export const areStructuredMailSearchesEqual = (
  left: StructuredMailSearch,
  right: StructuredMailSearch,
) => serializeStructuredSearchState(left) === serializeStructuredSearchState(right);
