"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";

export type LabelGroupOption = { id: string; label: string };

const noGroupValue = "none";

export const LabelGroupSelect = ({
  disabled,
  id,
  noneLabel,
  onChange,
  options,
  value,
}: {
  disabled?: boolean;
  id: string;
  noneLabel: string;
  onChange: (groupId: string | null) => void;
  options: readonly LabelGroupOption[];
  value: string | null;
}) => (
  <Select
    items={[
      { label: noneLabel, value: noGroupValue },
      ...options.map((option) => ({ label: option.label, value: option.id })),
    ]}
    onValueChange={(next) => {
      onChange(next === null || next === noGroupValue ? null : next);
    }}
    value={value ?? noGroupValue}
  >
    <SelectTrigger disabled={disabled} id={id}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent align="start">
      <SelectItem value={noGroupValue}>{noneLabel}</SelectItem>
      {options.map((option) => (
        <SelectItem key={option.id} value={option.id}>
          {option.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);
