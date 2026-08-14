import type { StructuredMailSearch } from "@quieter/mail/search";
import {
  normalizeStructuredMailSearch,
  parseStructuredSearchQuery,
} from "@quieter/mail/search";

export const normalizeManagedSearchValue = (value: string | null | undefined) =>
  value?.replaceAll(/\s+/gu, " ").trim().toLocaleLowerCase() ?? "";

export const createManagedMessageSearchText = (input: {
  bodyText?: string | null;
  snippet?: string | null;
  subject?: string | null;
}) =>
  [input.subject, input.snippet, input.bodyText]
    .map((value) => value?.replaceAll(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join(" ");

export const parseAbsoluteDate = (value: string) => {
  const match =
    /^(?<year>\d{4})[/-](?<month>\d{1,2})[/-](?<day>\d{1,2})$/u.exec(
      value.trim()
    );
  if (match?.groups === undefined) {
    return null;
  }

  const date = new Date(
    Number(match.groups.year),
    Number(match.groups.month) - 1,
    Number(match.groups.day)
  );
  return Number.isNaN(date.getTime()) ? null : date;
};

export const parseRelativeDate = (value: string, now: Date) => {
  const match = /^(?<amount>\d+)(?<unit>[dmy])$/iu.exec(value.trim());
  if (match?.groups === undefined) {
    return null;
  }

  const { amount: amountText, unit } = match.groups;
  const amount = Number(amountText);
  const date = new Date(now);
  if (unit.toLocaleLowerCase() === "d") {
    date.setDate(date.getDate() - amount);
  } else if (unit.toLocaleLowerCase() === "m") {
    date.setMonth(date.getMonth() - amount);
  } else {
    date.setFullYear(date.getFullYear() - amount);
  }
  return date;
};

export const parseManagedSearchQuery = (query: string | undefined) =>
  parseStructuredSearchQuery(query?.trim() ?? "");

export const assertManagedRuleSearch = (search: StructuredMailSearch) =>
  normalizeStructuredMailSearch(search);
