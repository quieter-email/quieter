"use client";

import { Clock01Icon } from "@hugeicons/core-free-icons";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
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
  const [editing, setEditing] = useState(false);
  return (
    <>
      {value ? (
        <DropdownMenu>
          <IconButtonTooltip
            label={`Follow up if no reply, ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: value.timeZone }).format(new Date(value.dueAt))}`}
          >
            <DropdownMenuTrigger
              render={
                <ToolbarButton
                  className="max-w-36"
                  disabled={disabled}
                  variant="selected"
                />
              }
              aria-label="Change follow-up reminder"
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
            </DropdownMenuTrigger>
          </IconButtonTooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                onChange({
                  ...value,
                  dueAt: getReminderPresetTime({
                    days: 1,
                    timeZone: value.timeZone,
                  }),
                });
              }}
            >
              Tomorrow morning
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onChange({
                  ...value,
                  dueAt: getReminderPresetTime({
                    days: 7,
                    timeZone: value.timeZone,
                  }),
                });
              }}
            >
              Next week
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setEditing(true);
              }}
            >
              Choose date or condition...
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                onChange(null);
              }}
              tone="destructive"
            >
              Remove follow-up reminder
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <IconButtonTooltip label="Follow up in a week if no reply">
          <ToolbarButton
            aria-label="Follow up in a week if no reply"
            disabled={disabled}
            onClick={() => {
              const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
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
      )}
      <Dialog
        onOpenChange={setEditing}
        open={editing && value !== null && value !== undefined}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Follow-up reminder</DialogTitle>
          </DialogHeader>
          <DialogBody spacing="4">
            {value ? (
              <ReminderEditor
                followUp
                initial={{
                  dueAt: value.dueAt,
                  target: { kind: "standalone" },
                  timeZone: value.timeZone,
                  title: value.title,
                }}
                initialCondition={value.condition}
                key={`${editing}:${value.requestId}`}
                onCancel={() => {
                  setEditing(false);
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
                    setEditing(false);
                  }
                }}
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};
