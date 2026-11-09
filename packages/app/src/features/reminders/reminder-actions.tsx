"use client";

import { MoreVerticalIcon } from "@hugeicons/core-free-icons";
import type { Reminder } from "@quieter/mail/reminders";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";

import { useReminderMutation } from "./reminder-mutations";
import { getReminderPresetTime } from "./reminder-time";

export const ReminderSnoozeMenu = ({
  reminder,
  demo,
  onCustom,
}: {
  reminder: Reminder;
  demo: boolean;
  onCustom: () => void;
}) => {
  const mutation = useReminderMutation({ demo, reminder });
  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger disabled={mutation.isPending}>
        Snooze
      </DropdownMenuSubmenuTrigger>
      <DropdownMenuSubmenuContent>
        <DropdownMenuItem
          onSelect={() => {
            mutation.mutate({
              dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
              kind: "snooze",
              timeZone: reminder.timeZone,
            });
          }}
        >
          In an hour
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            mutation.mutate({
              dueAt: getReminderPresetTime({
                days: 1,
                timeZone: reminder.timeZone,
              }),
              kind: "snooze",
              timeZone: reminder.timeZone,
            });
          }}
        >
          Tomorrow morning
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            mutation.mutate({
              dueAt: getReminderPresetTime({
                days: 7,
                timeZone: reminder.timeZone,
              }),
              kind: "snooze",
              timeZone: reminder.timeZone,
            });
          }}
        >
          Next week
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCustom}>Custom date...</DropdownMenuItem>
      </DropdownMenuSubmenuContent>
    </DropdownMenuSubmenu>
  );
};

export const ReminderActions = ({
  reminder,
  demo,
  onEdit,
  onCustomSnooze = onEdit,
  onDetails,
}: {
  reminder: Reminder;
  demo: boolean;
  onEdit: () => void;
  onCustomSnooze?: () => void;
  onDetails?: () => void;
}) => {
  const mutation = useReminderMutation({ demo, reminder });
  return (
    <DropdownMenu>
      <IconButtonTooltip label="Reminder actions">
        <DropdownMenuTrigger
          appearance="icon-transparent"
          aria-label="Reminder actions"
          disabled={mutation.isPending}
        >
          <Icon size={14} icon={MoreVerticalIcon} />
        </DropdownMenuTrigger>
      </IconButtonTooltip>
      <DropdownMenuContent align="end">
        {onDetails ? (
          <DropdownMenuItem onSelect={onDetails}>Details</DropdownMenuItem>
        ) : null}
        {reminder.status === "active" ? (
          <>
            <ReminderSnoozeMenu
              demo={demo}
              onCustom={onCustomSnooze}
              reminder={reminder}
            />
            <DropdownMenuItem onSelect={onEdit}>Edit reminder</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                mutation.mutate({ kind: "cancel" });
              }}
              tone="destructive"
            >
              Cancel reminder
            </DropdownMenuItem>
          </>
        ) : (
          <>
            <DropdownMenuItem
              onSelect={() => {
                mutation.mutate({ kind: "reactivate" });
              }}
            >
              Reactivate reminder
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>Edit reminder</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
