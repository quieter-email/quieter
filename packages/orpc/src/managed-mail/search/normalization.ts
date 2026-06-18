import type { StructuredMailSearch } from "@quieter/mail/search";
import { normalizeStructuredMailSearch, parseStructuredSearchQuery } from "@quieter/mail/search";

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

export const parseAbsoluteDate = (value: string) => {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseRelativeDate = (value: string, now: Date) => {
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
