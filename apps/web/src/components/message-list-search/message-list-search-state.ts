"use client";

import type { GmailLabelListItem } from "~/lib/gmail/gmail";

export type SearchCategoryFilterId = "personal" | "social" | "promotions" | "updates" | "forums";
export type SearchDropdownSectionId = "categories" | "labels";

export type StructuredSearchState = {
  categoryFilter: SearchCategoryFilterId | null;
  text: string;
  userLabels: string[];
};

type SearchFilterOption<T extends string> = {
  id: T;
  label: string;
  token: string;
};

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
  /(^|\s)(category:(?:forums|personal|promotions|social|updates)|label:"(?:[^"\\]|\\.)*"|label:[^\s]+)(?=\s|$)/gi;

export const SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID = Object.fromEntries(
  SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => [option.id, option]),
) as Record<SearchCategoryFilterId, SearchFilterOption<SearchCategoryFilterId>>;

const SEARCH_CATEGORY_FILTER_IDS_BY_TOKEN = Object.fromEntries(
  SEARCH_CATEGORY_FILTER_OPTIONS.map((option) => [option.token, option.id]),
) as Record<string, SearchCategoryFilterId>;

export const createStructuredSearchState = (): StructuredSearchState => ({
  categoryFilter: null,
  text: "",
  userLabels: [],
});

export const normalizeSearchText = (value: string) => value.replace(/\s+/g, " ").trim();
export const normalizeLabelSelectionKey = (value: string) => value.trim().toLocaleLowerCase();
export const getUserLabels = (labels: readonly GmailLabelListItem[]) =>
  labels.filter((label) => label.type === "user");

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
    const categoryFilterId = SEARCH_CATEGORY_FILTER_IDS_BY_TOKEN[normalizedToken];
    if (categoryFilterId) {
      nextState.categoryFilter = categoryFilterId;
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
    ...(state.categoryFilter
      ? [SEARCH_CATEGORY_FILTER_OPTIONS_BY_ID[state.categoryFilter].token]
      : []),
    ...state.userLabels.map((labelName) => serializeSearchLabelToken(labelName)).filter(Boolean),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

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
  if (state.categoryFilter) return { ...state, categoryFilter: null };
  return state;
};
