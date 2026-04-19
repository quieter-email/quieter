"use client";

import type { GmailLabelListItem } from "~/lib/gmail/gmail";

export type SearchFilterType = "after" | "before" | "from" | "label" | "to";
export type SearchFieldFilterType = Exclude<SearchFilterType, "label">;

export type SearchFilterChip = {
  type: SearchFilterType;
  value: string;
};

export type StructuredSearchState = {
  filters: SearchFilterChip[];
  text: string;
};

export type StructuredSearchQuerySegment =
  | {
      end: number;
      start: number;
      type: "text";
      value: string;
    }
  | {
      end: number;
      filter: SearchFilterChip;
      start: number;
      token: string;
      type: "filter";
    };

const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();

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

const parseFilterType = (value: string): SearchFilterType | null => {
  switch (value.toLocaleLowerCase()) {
    case "after":
    case "before":
    case "from":
    case "label":
    case "to":
      return value.toLocaleLowerCase() as SearchFilterType;
    default:
      return null;
  }
};

const mergeStructuredSearchFilter = (filters: SearchFilterChip[], filter: SearchFilterChip) => {
  if (filter.type === "label") {
    const nextLabelKey = normalizeLabelSelectionKey(filter.value);
    if (
      filters.some(
        (current) =>
          current.type === "label" && normalizeLabelSelectionKey(current.value) === nextLabelKey,
      )
    ) {
      return;
    }

    filters.push(filter);
    return;
  }

  const existingIndex = filters.findIndex((current) => current.type === filter.type);
  if (existingIndex === -1) {
    filters.push(filter);
    return;
  }

  filters[existingIndex] = filter;
};

const readStructuredToken = (query: string, start: number) => {
  let cursor = start;
  while (cursor < query.length && /[a-z]/i.test(query[cursor] ?? "")) {
    cursor += 1;
  }

  if (cursor === start || query[cursor] !== ":") {
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

export const normalizeLabelSelectionKey = (value: string) => value.trim().toLocaleLowerCase();
export const getUserLabels = (labels: readonly GmailLabelListItem[]) =>
  labels.filter((label) => label.type === "user");

export const parseStructuredSearchFilterToken = (token: string): SearchFilterChip | null => {
  const separatorIndex = token.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  const type = parseFilterType(token.slice(0, separatorIndex));
  if (!type) {
    return null;
  }

  const rawValue = token.slice(separatorIndex + 1);
  if (rawValue.length === 0) {
    return type === "label" ? null : { type, value: "" };
  }

  const value = parseQuotedValue(rawValue).trim();
  if (!value) {
    return null;
  }

  return { type, value };
};

export const serializeStructuredSearchFilterToken = ({ type, value }: SearchFilterChip) => {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    return type === "label" ? "" : `${type}:`;
  }

  const escapedValue = normalizedValue.replace(/(["\\])/g, "\\$1");
  return /[\s"\\]/.test(normalizedValue)
    ? `${type}:"${escapedValue}"`
    : `${type}:${normalizedValue}`;
};

export const tokenizeStructuredSearchQuery = (query: string): StructuredSearchQuerySegment[] => {
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
    const filter = token ? parseStructuredSearchFilterToken(token) : null;
    if (!filter || !token) {
      cursor += 1;
      continue;
    }

    if (textStart < cursor) {
      segments.push({
        end: cursor,
        start: textStart,
        type: "text",
        value: query.slice(textStart, cursor),
      });
    }

    segments.push({
      end: cursor + token.length,
      filter,
      start: cursor,
      token,
      type: "filter",
    });

    cursor += token.length;
    textStart = cursor;
  }

  if (textStart < query.length) {
    segments.push({
      end: query.length,
      start: textStart,
      type: "text",
      value: query.slice(textStart),
    });
  }

  if (segments.length === 0) {
    return [{ end: query.length, start: 0, type: "text", value: query }];
  }

  return segments;
};

export const parseStructuredSearchQuery = (query: string): StructuredSearchState => {
  const filters: SearchFilterChip[] = [];
  const textParts: string[] = [];

  for (const segment of tokenizeStructuredSearchQuery(query)) {
    if (segment.type === "text") {
      textParts.push(segment.value);
      continue;
    }

    mergeStructuredSearchFilter(filters, segment.filter);
  }

  return {
    filters,
    text: normalizeSearchText(textParts.join("")),
  };
};
