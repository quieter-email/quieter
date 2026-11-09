"use client";

import { ArrowUpRight01Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import type { Reminder } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { Icon } from "@quieter/ui/icon";
import { Text } from "@quieter/ui/text";

import { ReminderMailContext } from "./reminder-mail-context";
import { useReminderMutation } from "./reminder-mutations";

export const ReminderDetails = ({
  reminder,
  demo,
  onEdit,
  onOpenMail,
}: {
  reminder: Reminder;
  demo: boolean;
  onEdit: (reminder: Reminder) => void;
  onOpenMail: () => void;
}) => {
  const { timeFormat } = useDateTimePreferences();
  const change = useReminderMutation({ demo, reminder });
  const active = reminder.status === "active";
  return (
    <article aria-label="Reminder details" className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-1">
          <Checkbox
            aria-label={active ? `Complete ${reminder.title}` : reminder.status}
            checked={reminder.status === "completed"}
            disabled={!active || change.isPending}
            onCheckedChange={() => {
              change.mutate({ kind: "complete" });
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
        </div>
        <Text as="h2" size="lg" weight="medium">
          {reminder.title}
        </Text>
      </div>
      <div className="space-y-2">
        <Text as="p" size="caption" tone="muted">
          When
        </Text>
        <Button
          onClick={() => {
            onEdit(reminder);
          }}
          size="auto"
          variant="secondary"
        >
          <Icon icon={Clock01Icon} tone="muted" />
          <span className="min-w-0 space-y-1">
            <span className="block">
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: "medium",
                hour12: timeFormat === "12h",
                timeStyle: "short",
                timeZone: reminder.timeZone,
              }).format(new Date(reminder.dueAt))}
            </span>
            <span className="block text-caption text-muted-fg">
              {reminder.timeZone}
            </span>
          </span>
        </Button>
      </div>
      {reminder.target.kind === "thread" ? (
        <div className="space-y-2">
          <Text as="p" size="caption" tone="muted">
            Linked mail
          </Text>
          <ReminderMailContext
            layout="summary"
            mailboxId={reminder.mailboxId}
            target={reminder.target}
          />
          <Button onClick={onOpenMail} size="sm" variant="ghost">
            Open conversation <Icon icon={ArrowUpRight01Icon} />
          </Button>
        </div>
      ) : null}
      {reminder.target.kind === "thread" && reminder.target.condition ? (
        <div className="space-y-1.5">
          <Text as="p" size="caption" tone="muted">
            Complete when
          </Text>
          <Text as="p" size="sm">
            {reminder.target.condition}
          </Text>
        </div>
      ) : null}
      {reminder.source ? (
        <div className="space-y-1.5">
          <Text as="p" size="caption" tone="muted">
            {reminder.source.kind === "automatic"
              ? "Added automatically"
              : "From a suggestion"}
          </Text>
          <Text as="p" size="sm">
            {reminder.source.reason}
          </Text>
        </div>
      ) : null}
      {reminder.evaluationStatus === "pending" ? (
        <Text as="p" size="sm" tone="muted">
          Checking replies...
        </Text>
      ) : null}
      {reminder.evaluationSummary ? (
        <Text as="p" size="sm" tone="muted">
          {reminder.evaluationSummary}
        </Text>
      ) : null}
      {reminder.status === "suspended" ? (
        <Text as="p" size="sm" tone="muted">
          Paused because mailbox access is unavailable.
        </Text>
      ) : null}
      {reminder.status === "completed" ? (
        <Text as="p" size="sm" tone="muted">
          {reminder.resolution === "fulfilled"
            ? "Completed because the reply condition was met."
            : "Completed by you."}
        </Text>
      ) : null}
      {reminder.status === "cancelled" ? (
        <Text as="p" size="sm" tone="muted">
          Cancelled by you.
        </Text>
      ) : null}
    </article>
  );
};
