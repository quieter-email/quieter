"use client";

import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import type { Reminder } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import { CardStack } from "@quieter/ui/card-stack";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { useDateTimePreferences } from "@quieter/ui/date-time-preferences";
import { useQueries } from "@tanstack/react-query";
import { use, useState } from "react";

import { ReminderActions } from "./reminder-actions";
import { useReminderMutation } from "./reminder-mutations";
import { reminderListOptions, useReminderClock } from "./reminder-query";

const ReminderDueRow = ({
  reminder,
  demo,
  now,
  onOpen,
  onEdit,
}: {
  reminder: Reminder;
  demo: boolean;
  now: number;
  onOpen: () => void;
  onEdit: () => void;
}) => {
  const { timeFormat } = useDateTimePreferences();
  const change = useReminderMutation({ demo, reminder });

  return (
    <>
      <Checkbox
        aria-label={`Complete ${reminder.title}`}
        checked={false}
        disabled={change.isPending}
        onCheckedChange={() => {
          change.mutate({ kind: "complete" });
        }}
      >
        <CheckboxIndicator />
      </Checkbox>
      <Button
        className="min-w-0 flex-1"
        onClick={onOpen}
        title={reminder.title}
        variant="inline-edit"
      >
        <span className="truncate">{reminder.title}</span>
      </Button>
      <time
        className="shrink-0 text-caption text-muted-fg"
        dateTime={reminder.dueAt}
      >
        {Date.parse(reminder.dueAt) <= now
          ? "Due now"
          : new Intl.DateTimeFormat(undefined, {
              hour: "numeric",
              hour12: timeFormat === "12h",
              minute: "2-digit",
              timeZone: reminder.timeZone,
            }).format(new Date(reminder.dueAt))}
      </time>
      <div className="shrink-0" data-card-stack-actions>
        <ReminderActions demo={demo} onEdit={onEdit} reminder={reminder} />
      </div>
    </>
  );
};

export const ReminderDueStrip = ({
  mailboxId,
  demo = false,
  scopes,
}: {
  mailboxId?: string;
  demo?: boolean;
  scopes?: { mailboxId: string; demo: boolean }[];
}) => {
  const sidebar = use(AssistantSidebarContext);
  const navigate = useMailboxSearchActions();
  const [pinnedScope, setPinnedScope] = useState<string | null>(null);
  const mailboxScopes = scopes ?? (mailboxId ? [{ demo, mailboxId }] : []);
  const scopeKey = mailboxScopes
    .map((scope) => `${scope.mailboxId}:${scope.demo}`)
    .toSorted()
    .join("|");
  const queries = useQueries({
    queries: mailboxScopes.map((scope) =>
      reminderListOptions(scope.mailboxId, "active", scope.demo)
    ),
  });
  const items = queries.flatMap((query) =>
    query.isError ? [] : (query.data?.items ?? [])
  );
  const now = useReminderClock(items);
  const due = items
    .filter(
      (item) =>
        item.status === "active" && Date.parse(item.dueAt) <= now + 30 * 60_000
    )
    .toSorted((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt));
  const [first] = due;
  if (first === undefined || sidebar === null) {
    return null;
  }

  return (
    <CardStack
      footer={
        due.length > 3 ? (
          <Button
            onClick={(event) => {
              void sidebar.onOpenReminders(
                event.currentTarget,
                first.mailboxId
              );
            }}
            size="text"
            variant="ghost"
          >
            View all reminders
          </Button>
        ) : undefined
      }
      items={due.slice(0, 3).map((reminder) => ({
        content: (
          <ReminderDueRow
            demo={mailboxScopes.some(
              (scope) => scope.mailboxId === reminder.mailboxId && scope.demo
            )}
            now={now}
            onEdit={() => {
              void sidebar.onOpenReminders(
                undefined,
                reminder.mailboxId,
                reminder.id
              );
            }}
            onOpen={() => {
              if (reminder.target.kind === "thread") {
                void navigate({
                  mailbox: "inbox",
                  mailboxId: reminder.mailboxId,
                  messageId: reminder.target.anchorMessageId,
                  threadId: reminder.target.threadId,
                  workspace: null,
                });
              } else {
                void sidebar.onOpenReminders(
                  undefined,
                  reminder.mailboxId,
                  reminder.id
                );
              }
            }}
            reminder={reminder}
          />
        ),
        id: reminder.id,
      }))}
      label="Due reminders"
      onPinnedChange={(next) => {
        setPinnedScope(next ? scopeKey : null);
      }}
      pinned={pinnedScope === scopeKey}
      totalCount={due.length}
    />
  );
};
