"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";

import { MailboxLabelSwatch } from "./mailbox-label-swatch";

export type LabelGroupOption = {
  color: MailboxLabelColor;
  id: string;
  label: string;
};

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
}) => {
  const selectedGroup = options.find((option) => option.id === value);

  return (
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
        {selectedGroup ? (
          <MailboxLabelSwatch color={selectedGroup.color} kind="group" />
        ) : null}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start">
        <SelectItem value={noGroupValue}>{noneLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <span className="flex min-w-0 items-center gap-2">
              <MailboxLabelSwatch color={option.color} kind="group" />
              <span className="min-w-0 truncate">{option.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
