import { serializeStructuredSearchState } from "@quieter/mail/search";
import { isRepeatableMailSearchFilter } from "@quieter/mail/search";
import {
  normalizeLabelSelectionKey,
  type SearchFilterChip,
} from "~/features/message-search/state/message-list-search-state";
import type { DropdownDirection } from "./message-list-search-types";

const initialCalendarFallbackMonth = new Date(0);
const clientCalendarFallbackMonth = new Date();

export const filterChipClassName =
  "squircle inline-flex h-7 shrink-0 items-center rounded-lg bg-background-light text-[13px] text-foreground";

export const subscribeToCalendarFallbackMonth = () => () => {};
export const getCalendarFallbackMonth = () => clientCalendarFallbackMonth;
export const getServerCalendarFallbackMonth = () => initialCalendarFallbackMonth;

export const formatDateFilterValue = (date: Date) =>
  `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;

export const parseDateFilterValue = (value: string) => {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value.trim());
  if (!match) {
    return undefined;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return undefined;
  }

  return date;
};

export { serializeStructuredSearchState };

export const getDropdownDirection = (key: string): DropdownDirection | null =>
  key === "ArrowDown" ? "next" : key === "ArrowUp" ? "previous" : null;

export const isDateFilter = ({ type }: SearchFilterChip) => type === "after" || type === "before";

export const isFixedValueFilter = ({ type }: SearchFilterChip) => type === "has" || type === "is";

export const shouldFocusFilterValueEnd = (filter: SearchFilterChip | undefined) =>
  !!filter && filter.type !== "label" && !isFixedValueFilter(filter);

export const isCaretAtStart = (input: HTMLInputElement) =>
  input.selectionStart === 0 && input.selectionEnd === 0;

export const isCaretAtEnd = (input: HTMLInputElement) =>
  input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

export const findLabelFilterIndex = (filters: readonly SearchFilterChip[], labelName: string) => {
  const labelKey = normalizeLabelSelectionKey(labelName);
  return filters.findIndex(
    (filter) => filter.type === "label" && normalizeLabelSelectionKey(filter.value) === labelKey,
  );
};

export const upsertFilter = (
  filters: readonly SearchFilterChip[],
  nextFilter: SearchFilterChip,
) => {
  if (nextFilter.type === "label") {
    const existingIndex = findLabelFilterIndex(filters, nextFilter.value);
    if (existingIndex !== -1) {
      return { filters: [...filters], index: existingIndex };
    }

    return { filters: [...filters, nextFilter], index: filters.length };
  }

  if (isRepeatableMailSearchFilter(nextFilter.type)) {
    const unfinishedIndex = filters.findIndex(
      (filter) => filter.type === nextFilter.type && filter.value.trim().length === 0,
    );
    if (unfinishedIndex !== -1) {
      return { filters: [...filters], index: unfinishedIndex };
    }
    return { filters: [...filters, nextFilter], index: filters.length };
  }

  const existingIndex = filters.findIndex((filter) => filter.type === nextFilter.type);
  if (existingIndex === -1) {
    return { filters: [...filters, nextFilter], index: filters.length };
  }

  const nextFilters = [...filters];
  nextFilters[existingIndex] = nextFilter;
  return { filters: nextFilters, index: existingIndex };
};
