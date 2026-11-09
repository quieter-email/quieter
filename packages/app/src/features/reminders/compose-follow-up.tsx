"use client";

import { Clock01Icon } from "@hugeicons/core-free-icons";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@quieter/ui/popover";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useState } from "react";

import { ReminderEditor } from "./reminder-editor";
import { getReminderPresetTime } from "./reminder-time";

export const ComposeFollowUp = ({
  value,
  onChange,
  disabled,
  subject,
}: {
  value: FollowUpReminderIntent | null | undefined;
  onChange: (value: FollowUpReminderIntent | null) => void;
  disabled: boolean;
  subject: string;
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const { timeFormat } = useDateTimePreferences();
  if (!value) {
    return (
      <IconButtonTooltip label="Follow up in a week if no reply">
        <ToolbarButton
          aria-label="Follow up in a week if no reply"
          disabled={disabled}
          onClick={() => {
            const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
            setEditingId(null);
            onChange({
              condition:
                "The recipient gives a substantive reply to this message",
              dueAt: getReminderPresetTime({ days: 7, timeZone }),
              requestId: crypto.randomUUID(),
              timeZone,
              title: subject.trim()
                ? `Follow up on ${subject.trim()}`.slice(0, 240)
                : "Follow up on my message",
            });
          }}
          size="icon"
          type="button"
        >
          <Icon icon={Clock01Icon} />
        </ToolbarButton>
      </IconButtonTooltip>
    );
  }
  return (
    <Popover
      open={editingId === value.requestId}
      onOpenChange={(open) => {
        setEditingId(open ? value.requestId : null);
      }}
    >
      <IconButtonTooltip
        label={`Follow up if no reply, ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", hour12: timeFormat === "12h", timeStyle: "short", timeZone: value.timeZone }).format(new Date(value.dueAt))}`}
      >
        <PopoverTrigger
          aria-label="Change follow-up reminder"
          render={
            <ToolbarButton
              className="max-w-36"
              disabled={disabled}
              variant="selected"
            />
          }
        >
          <Icon icon={Clock01Icon} />
          <span className="min-w-0 truncate">
            If no reply,{" "}
            {new Intl.DateTimeFormat(undefined, {
              day: "numeric",
              month: "short",
              timeZone: value.timeZone,
            }).format(new Date(value.dueAt))}
          </span>
        </PopoverTrigger>
      </IconButtonTooltip>
      <PopoverContent
        align="end"
        aria-label="Follow-up reminder"
        scrollable
        side="top"
        size="sm"
      >
        <div className="space-y-4">
          <PopoverTitle>Follow-up reminder</PopoverTitle>
          <ReminderEditor
            followUp
            initial={{
              dueAt: value.dueAt,
              target: { kind: "standalone" },
              timeZone: value.timeZone,
              title: value.title,
            }}
            initialCondition={value.condition}
            key={value.requestId}
            onCancel={() => {
              setEditingId(null);
            }}
            onRemove={() => {
              onChange(null);
              setEditingId(null);
            }}
            onSave={(values) => {
              if (values.condition) {
                onChange({
                  condition: values.condition,
                  dueAt: values.dueAt,
                  requestId: value.requestId,
                  timeZone: values.timeZone,
                  title: values.title,
                });
                setEditingId(null);
              }
            }}
            pending={disabled}
            submitLabel="Save"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
};
