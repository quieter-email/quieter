"use client";

import type { GmailLabelListItem } from "~/lib/gmail/gmail";

export type SearchStateFilterId = "unread" | "starred" | "important";
export type SearchCategoryFilterId = "personal" | "social" | "promotions" | "updates" | "forums";
export type SearchDropdownSectionId = "categories" | "labels";
export type SearchDateFilterId = "after" | "before";

export type StructuredSearchState = {
  after: string;
  before: string;
  categoryFilter: SearchCategoryFilterId | null;
  stateFilters: SearchStateFilterId[];
  text: string;
  userLabels: string[];
};

type SearchFilterOption<T extends string> = {
  id: T;
  label: string;
  token: string;
};

export const SEARCH_STATE_FILTER_OPTIONS: ReadonlyArray<SearchFilterOption<SearchStateFilterId>> = [
  { id: "unread", label: "Unread", token: "is:unread" },
  { id: "starred", label: "Starred", token: "is:starred" },
  { id: "important", label: "Important", token: "is:important" },
];

export const SEARCH_CATEGORY_FILTER_OPTIONS: ReadonlyArray<
  SearchFilterOption<SearchCategoryFilterId>
> = [
  { id: "personal", label: "Personal", token: "category:personal" },
  { id: "social", label: "Social", token: "category:social" },
  { id: "promotions", label: "Promotions", token: "category:promotions" },
  { id: "updates", label: "Updates", token: "category:updates" },
  { id: "forums", label: "Forums", token: "category:forums" },
];

export const SEARCH_DROPDOWN_SECTIONS: ReadonlyArray<{
  id: SearchDropdownSectionId;
  label: string;
}> = [
  { id: "categories", label: "Categories" },
  { id: "labels", label: "Labels" },
];

const STRUCTURED_SEARCH_QUERY_TOKEN_PATTERN =
  /(^|\s)(is:(?:unread|starred|important)|category:(?:forums|personal|promotions|social|updates)|after:(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{9,})|before:(?:\d{4}[/-]\d{1,2}[/-]\d{1,2}|\d{9,})|label:"(?:[^"\\]|\\.)*"|label:[^\s]+)(?=\s|$)/gi;

export const SEARCH_STATE_FILTER_OPTIONS_BY_ID = Object.fromEntries(
  SEARCH_STATE_FILTER_OPTIONS.map((option) => [option.id, option]),
) as Record<SearchStateFilterId, SearchFilterOption<SearchStateFilterId>>;

export const SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID = Object.fromEntries(
  SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => [option.id, option]),
) as Record<SearchCategoryFilterId, SearchFilterOption<SearchCategoryFilterId>>;

const SEARCH_STATE_FILTER_IDS_BY_TOKEN = Object.fromEntries(
  SEARCH_STATE_FILTER_OPTIONS.map((option) => [option.token, option.id]),
) as Record<string, SearchStateFilterId>;

const SEARCH_CATEGORY_FILTER_IDS_BY_TOKEN = Object.fromEntries(
  SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => [option.token, option.id]),
) as Record<string, SearchCategoryFilterId>;

const SEARCH_DATE_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  year: "numeric",
});

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const LOCAL_DATE_PATTERN = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;

export const createStructuredSearchState = (): StructuredSearchState => ({
  after: "",
  before: "",
  categoryFilter: null,
  stateFilters: [],
  text: "",
  userLabels: [],
});

const isValidDateParts = (year: number, month: number, day: number) => {
  const parsedDate = new Date(year, month - 1, day);
  return (
    parsedDate.getFullYear() === year &&
    parsedDate.getMonth() === month - 1 &&
    parsedDate.getDate() === day
  );
};

const isValidTimeParts = (hours: number, minutes: number) =>
  hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;

export const parseSearchDateTimeValue = (value: string) => {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hours = Number(match[4]);
  const minutes = Number(match[5]);

  if (!isValidDateParts(year, month, day) || !isValidTimeParts(hours, minutes)) return null;

  return new Date(year, month - 1, day, hours, minutes);
};

export const formatSearchDateTimeValue = (date: Date) =>
  `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const normalizeSearchDateTimeValue = (value: string) => {
  const trimmedValue = value.trim();
  if (!trimmedValue) return "";

  if (/^\d{9,}$/.test(trimmedValue)) {
    const parsedDate = new Date(Number(trimmedValue) * 1000);
    if (Number.isNaN(parsedDate.getTime())) return "";
    return formatSearchDateTimeValue(parsedDate);
  }

  const localDateTime = parseSearchDateTimeValue(trimmedValue);
  if (localDateTime) return formatSearchDateTimeValue(localDateTime);

  const dateMatch = LOCAL_DATE_PATTERN.exec(trimmedValue);
  if (!dateMatch) return "";

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  if (!isValidDateParts(year, month, day)) return "";

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00`;
};

export const getSearchDateTimeTimeValue = (value: string) => {
  const parsedValue = parseSearchDateTimeValue(value);
  if (!parsedValue) return "";
  return `${String(parsedValue.getHours()).padStart(2, "0")}:${String(parsedValue.getMinutes()).padStart(2, "0")}`;
};

export const setSearchDateTimeDate = (currentValue: string, nextDate: Date) => {
  const currentDateTime = parseSearchDateTimeValue(currentValue);
  return formatSearchDateTimeValue(
    new Date(
      nextDate.getFullYear(),
      nextDate.getMonth(),
      nextDate.getDate(),
      currentDateTime?.getHours() ?? 0,
      currentDateTime?.getMinutes() ?? 0,
    ),
  );
};

export const setSearchDateTimeTime = (currentValue: string, nextTime: string) => {
  const timeMatch = TIME_PATTERN.exec(nextTime);
  const currentDateTime = parseSearchDateTimeValue(currentValue);
  if (!timeMatch || !currentDateTime) return currentValue;

  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  if (!isValidTimeParts(hours, minutes)) return currentValue;

  return formatSearchDateTimeValue(
    new Date(
      currentDateTime.getFullYear(),
      currentDateTime.getMonth(),
      currentDateTime.getDate(),
      hours,
      minutes,
    ),
  );
};

export const formatSearchDateTimeDisplayValue = (value: string) => {
  const parsedValue = parseSearchDateTimeValue(value);
  return parsedValue ? SEARCH_DATE_TIME_FORMATTER.format(parsedValue) : value.replace("T", " ");
};

export const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();
export const normalizeLabelSelectionKey = (value: string) => value.trim().toLocaleLowerCase();
export const getUserLabels = (labels: readonly GmailLabelListItem[]) =>
  labels.filter((label) => label.type === "user");

const parseSearchDateToken = (token: string, filterId: SearchDateFilterId) => {
  const match = new RegExp(`^${filterId}:(\\d{9,}|\\d{4}[/-]\\d{1,2}[/-]\\d{1,2})$`, "i").exec(
    token,
  );
  return match?.[1] ? normalizeSearchDateTimeValue(match[1]) : "";
};

const serializeSearchDateToken = (filterId: SearchDateFilterId, value: string) => {
  const normalizedValue = normalizeSearchDateTimeValue(value);
  const parsedValue = parseSearchDateTimeValue(normalizedValue);
  if (!parsedValue) return "";
  return `${filterId}:${Math.floor(parsedValue.getTime() / 1000)}`;
};

const parseSearchLabelToken = (token: string) => {
  const quotedMatch = /^label:"((?:[^"\\]|\\.)*)"$/i.exec(token);
  if (quotedMatch?.[1] !== undefined) return quotedMatch[1].replace(/\\(.)/g, "$1");
  return /^label:(.+)$/i.exec(token)?.[1] ?? null;
};

const serializeSearchLabelToken = (labelName: string) => {
  const normalizedLabelName = labelName.trim();
  if (!normalizedLabelName) return "";
  const escapedLabelName = normalizedLabelName.replace(/(["\\])/g, "\\$1");
  return /[^A-Za-z0-9_-]/.test(normalizedLabelName)
    ? `label:"${escapedLabelName}"`
    : `label:${normalizedLabelName}`;
};

const addUserLabelSelection = (current: readonly string[], labelName: string) => {
  const nextLabelName = labelName.trim();
  if (!nextLabelName) return [...current];
  const nextLabelKey = normalizeLabelSelectionKey(nextLabelName);
  if (current.some((value) => normalizeLabelSelectionKey(value) === nextLabelKey))
    return [...current];
  return [...current, nextLabelName];
};

export const removeUserLabelSelection = (current: readonly string[], labelName: string) =>
  current.filter(
    (value) => normalizeLabelSelectionKey(value) !== normalizeLabelSelectionKey(labelName),
  );

export const parseStructuredSearchQuery = (query: string): StructuredSearchState => {
  const nextState = createStructuredSearchState();
  const textSegments: string[] = [];
  let lastIndex = 0;

  STRUCTURED_SEARCH_QUERY_TOKEN_PATTERN.lastIndex = 0;
  for (const match of query.matchAll(STRUCTURED_SEARCH_QUERY_TOKEN_PATTERN)) {
    const matchIndex = match.index ?? 0;
    const token = match[2];
    textSegments.push(query.slice(lastIndex, matchIndex));
    lastIndex = matchIndex + match[0].length;
    if (!token) continue;

    const normalizedToken = token.toLocaleLowerCase();
    const stateFilterId = SEARCH_STATE_FILTER_IDS_BY_TOKEN[normalizedToken];
    if (stateFilterId) {
      if (!nextState.stateFilters.includes(stateFilterId))
        nextState.stateFilters = [...nextState.stateFilters, stateFilterId];
      continue;
    }

    const categoryFilterId = SEARCH_CATEGORY_FILTER_IDS_BY_TOKEN[normalizedToken];
    if (categoryFilterId) {
      nextState.categoryFilter = categoryFilterId;
      continue;
    }

    if (normalizedToken.startsWith("after:")) {
      nextState.after = parseSearchDateToken(token, "after");
      continue;
    }

    if (normalizedToken.startsWith("before:")) {
      nextState.before = parseSearchDateToken(token, "before");
      continue;
    }

    const userLabel = parseSearchLabelToken(token);
    if (userLabel) nextState.userLabels = addUserLabelSelection(nextState.userLabels, userLabel);
  }

  textSegments.push(query.slice(lastIndex));
  nextState.text = normalizeSearchText(textSegments.join(" "));
  return nextState;
};

export const serializeStructuredSearchQuery = (state: StructuredSearchState) =>
  [
    normalizeSearchText(state.text),
    ...state.stateFilters.map((id) => SEARCH_STATE_FILTER_OPTIONS_BY_ID[id].token),
    ...(state.categoryFilter
      ? [SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID[state.categoryFilter].token]
      : []),
    serializeSearchDateToken("after", state.after),
    serializeSearchDateToken("before", state.before),
    ...state.userLabels.map((labelName) => serializeSearchLabelToken(labelName)).filter(Boolean),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

export const toggleStateFilterInSearchState = (
  state: StructuredSearchState,
  filterId: SearchStateFilterId,
) => ({
  ...state,
  stateFilters: state.stateFilters.includes(filterId)
    ? state.stateFilters.filter((value) => value !== filterId)
    : [...state.stateFilters, filterId],
});

export const selectCategoryFilterInSearchState = (
  state: StructuredSearchState,
  categoryId: SearchCategoryFilterId,
) => ({
  ...state,
  categoryFilter: state.categoryFilter === categoryId ? null : categoryId,
});

export const toggleUserLabelInSearchState = (state: StructuredSearchState, labelName: string) => {
  const normalizedLabelKey = normalizeLabelSelectionKey(labelName);
  const hasLabel = state.userLabels.some(
    (value) => normalizeLabelSelectionKey(value) === normalizedLabelKey,
  );
  return {
    ...state,
    userLabels: hasLabel
      ? removeUserLabelSelection(state.userLabels, labelName)
      : addUserLabelSelection(state.userLabels, labelName),
  };
};

export const removeLastStructuredSearchChip = (
  state: StructuredSearchState,
): StructuredSearchState => {
  if (state.userLabels.length > 0) return { ...state, userLabels: state.userLabels.slice(0, -1) };
  if (state.before) return { ...state, before: "" };
  if (state.after) return { ...state, after: "" };
  if (state.categoryFilter) return { ...state, categoryFilter: null };
  if (state.stateFilters.length > 0)
    return { ...state, stateFilters: state.stateFilters.slice(0, -1) };
  return state;
};
