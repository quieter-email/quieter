"use client";

import { Add01Icon, Clock01Icon } from "@hugeicons/core-free-icons";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { getZonedDateTimeFields } from "@quieter/calendar/time";
import type { Reminder, ReminderTarget } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { Tabs, TabsList, TabsTab } from "@quieter/ui/tabs";
import { Text } from "@quieter/ui/text";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ReminderActions } from "./reminder-actions";
import { ReminderDetails } from "./reminder-details";
import { ReminderEditor } from "./reminder-editor";
import type { ReminderEditorValues } from "./reminder-editor";
import { ReminderMailContext } from "./reminder-mail-context";
import { cacheReminder, useReminderMutation } from "./reminder-mutations";
import { ReminderOptions } from "./reminder-options";
import {
  changeUiReminder,
  createUiReminder,
  demoReminderSession,
  useReminderList,
} from "./reminder-query";
import { ReminderQuickEntry } from "./reminder-quick-entry";
import { ReminderRowTime } from "./reminder-row-time";

export type ReminderOpenRequest =
  | { id: string; mailboxId: string; title: string; target: ReminderTarget }
  | { id: string; mailboxId: string; reminderId: string };

type ReminderEntry =
  | { kind: "quick"; requestId: string }
  | {
      kind: "details";
      initial: ReminderEditorValues;
      reminder?: Reminder;
      requestId: string;
    };

const ReminderItem = ({
  reminder,
  now,
  demo,
  onOpen,
  onDetails,
  onEdit,
}: {
  reminder: Reminder;
  now: number;
  demo: boolean;
  onOpen: () => void;
  onDetails: () => void;
  onEdit: () => void;
}) => {
  const mutation = useReminderMutation({ demo, reminder });
  const active = reminder.status === "active";
  let status: string | null = null;
  if (reminder.status === "suspended") {
    status = "Paused";
  } else if (reminder.status === "completed") {
    status = "Completed";
  } else if (reminder.status === "cancelled") {
    status = "Cancelled";
  } else if (reminder.evaluationStatus === "pending") {
    status = "Checking reply";
  } else if (reminder.target.kind === "thread" && reminder.target.condition) {
    status = "If no reply";
  }
  return (
    <li className="flex items-start gap-2.5">
      <div className="w-5 shrink-0 pt-0.5">
        <Checkbox
          aria-label={active ? `Complete ${reminder.title}` : reminder.status}
          checked={reminder.status === "completed"}
          disabled={!active || mutation.isPending}
          onCheckedChange={() => {
            mutation.mutate({ kind: "complete" });
          }}
        >
          <CheckboxIndicator />
        </Checkbox>
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <Button
          className="max-w-full"
          onClick={onOpen}
          size="text"
          variant="ghost"
        >
          <Text as="span" size="sm" tone="default" truncate weight="medium">
            {reminder.title}
          </Text>
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <ReminderRowTime now={now} reminder={reminder} />
          {status ? (
            <span className="text-caption text-muted-fg">{status}</span>
          ) : null}
        </div>
        {reminder.target.kind === "thread" ? (
          <ReminderMailContext
            mailboxId={reminder.mailboxId}
            target={reminder.target}
          />
        ) : null}
      </div>
      <div className="shrink-0">
        <ReminderActions
          demo={demo}
          onDetails={onDetails}
          onEdit={onEdit}
          reminder={reminder}
        />
      </div>
    </li>
  );
};

export const RemindersPanel = ({
  mailboxId,
  demo = false,
  request,
}: {
  mailboxId: string;
  demo?: boolean;
  request?: ReminderOpenRequest | null;
}) => {
  const client = useQueryClient();
  const navigate = useMailboxSearchActions();
  const mode = demo ? "demo" : "remote";
  const [view, setView] = useState<"active" | "history">("active");
  const [details, setDetails] = useState<Reminder | null>(null);
  const [requestDismissed, setRequestDismissed] = useState(false);
  const [entry, setEntry] = useState<ReminderEntry | null>(() =>
    request && "target" in request
      ? {
          initial: {
            dueAt: new Date(Date.now() + 60 * 60_000).toISOString(),
            target: request.target,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            title: request.title,
          },
          kind: "details",
          requestId: request.id,
        }
      : null
  );
  const reminders = useReminderList(mailboxId, view, demo);
  const selected = useQuery({
    enabled: Boolean(request && "reminderId" in request),
    queryFn: async ({ signal }) => {
      if (!request || !("reminderId" in request)) {
        return null;
      }
      if (demo) {
        return (
          demoReminderSession
            .get(mailboxId)
            ?.find((item) => item.id === request.reminderId) ?? null
        );
      }
      return await rpc.reminders.get(
        { mailboxId, reminderId: request.reminderId },
        { signal }
      );
    },
    queryKey: [
      "reminders",
      mailboxId,
      mode,
      "detail",
      request && "reminderId" in request ? request.reminderId : null,
    ],
  });
  const save = useMutation({
    mutationFn: async (values: ReminderEditorValues) => {
      if (entry?.kind === "details" && entry.reminder) {
        return await changeUiReminder(
          {
            command: { kind: "edit", ...values },
            expectedVersion: entry.reminder.version,
            mailboxId,
            reminderId: entry.reminder.id,
          },
          demo
        );
      }
      return await createUiReminder(
        {
          ...values,
          mailboxId,
          requestId: entry?.requestId ?? crypto.randomUUID(),
        },
        demo
      );
    },
    onError: (error) => {
      toastError(error, {
        boundary: "reminder-save",
        fallback: "Could not save the reminder. Please try again.",
      });
    },
    onSuccess: async (reminder) => {
      cacheReminder({ client, demo, reminder });
      setEntry(null);
      await client.invalidateQueries({
        queryKey: ["reminders", mailboxId, mode],
      });
    },
  });
  const items = (reminders.data?.items ?? []).filter((item) =>
    view === "active"
      ? item.status === "active" || item.status === "suspended"
      : item.status === "completed" || item.status === "cancelled"
  );
  const today = new Date(reminders.now).toISOString();
  const groups =
    view === "history"
      ? [{ items, title: "History" }]
      : [
          {
            items: items.filter(
              (item) =>
                item.status === "active" &&
                Date.parse(item.dueAt) <= reminders.now
            ),
            title: "Due now",
          },
          {
            items: items.filter(
              (item) =>
                item.status === "active" &&
                Date.parse(item.dueAt) > reminders.now &&
                getZonedDateTimeFields({
                  instant: item.dueAt,
                  timeZone: item.timeZone,
                }).date ===
                  getZonedDateTimeFields({
                    instant: today,
                    timeZone: item.timeZone,
                  }).date
            ),
            title: "Later today",
          },
          {
            items: items.filter(
              (item) =>
                item.status === "active" &&
                Date.parse(item.dueAt) > reminders.now &&
                getZonedDateTimeFields({
                  instant: item.dueAt,
                  timeZone: item.timeZone,
                }).date !==
                  getZonedDateTimeFields({
                    instant: today,
                    timeZone: item.timeZone,
                  }).date
            ),
            title: "Coming up",
          },
          {
            items: items.filter((item) => item.status === "suspended"),
            title: "Paused",
          },
        ];
  const handleEdit = (reminder: Reminder) => {
    setDetails(null);
    setRequestDismissed(true);
    setEntry({
      initial: reminder,
      kind: "details",
      reminder,
      requestId: crypto.randomUUID(),
    });
  };
  const open = (reminder: Reminder) => {
    if (reminder.target.kind === "thread") {
      void navigate({
        mailbox: "inbox",
        mailboxId,
        messageId: reminder.target.anchorMessageId,
        threadId: reminder.target.threadId,
        workspace: null,
      });
    } else {
      setDetails(reminder);
    }
  };
  let title = "Reminders";
  if (entry?.kind === "quick") {
    title = "New reminder";
  } else if (entry?.kind === "details") {
    title = entry.reminder ? "Edit reminder" : "New reminder";
  }
  return (
    <section aria-label="Reminders" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-4">
        {entry ? (
          <Text as="h2" size="lg" weight="medium">
            {title}
          </Text>
        ) : (
          <Tabs
            value={view}
            onValueChange={(value: unknown) => {
              if (value === "active" || value === "history") {
                setView(value);
              }
            }}
          >
            <TabsList aria-label="Reminder view" variant="plain">
              <TabsTab value="active">Upcoming</TabsTab>
              <TabsTab value="history">History</TabsTab>
            </TabsList>
          </Tabs>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {demo || entry ? null : <ReminderOptions mailboxId={mailboxId} />}
          {entry ? null : (
            <Button
              onClick={() => {
                setEntry({ kind: "quick", requestId: crypto.randomUUID() });
              }}
            >
              <Icon icon={Add01Icon} />
              New
            </Button>
          )}
        </div>
      </div>
      <div
        className={cn("min-h-0 flex-1 px-4 pb-4", {
          flex: entry?.kind === "details",
          "flex-col": entry?.kind === "details",
          "overflow-y-auto": entry?.kind !== "details",
        })}
      >
        {demo ? (
          <p className="mb-3 text-caption text-muted-fg">
            Demo reminders stay in this browser session.
          </p>
        ) : null}
        {entry?.kind === "quick" ? (
          <ReminderQuickEntry
            onCancel={() => {
              setEntry(null);
            }}
            onChooseDate={(initial) => {
              setEntry({
                initial,
                kind: "details",
                requestId: entry.requestId,
              });
            }}
            onSave={(values) => {
              save.mutate(values);
            }}
            pending={save.isPending}
          />
        ) : null}
        {entry?.kind === "details" ? (
          <ReminderEditor
            docked
            initial={entry.initial}
            key={entry.requestId}
            mailboxId={mailboxId}
            onCancel={() => {
              setEntry(null);
            }}
            onSave={({ title: nextTitle, dueAt, timeZone, target }) => {
              save.mutate({ dueAt, target, timeZone, title: nextTitle });
            }}
            pending={save.isPending}
          />
        ) : null}
        {entry === null ? (
          <>
            {reminders.isPending ? (
              <output className="block py-6 text-body-sm text-muted-fg">
                Loading reminders...
              </output>
            ) : null}
            {reminders.isError ? (
              <div className="space-y-3 py-6" role="alert">
                <p className="text-body-sm">Could not load reminders.</p>
                <Button
                  onClick={() => {
                    void reminders.refetch();
                  }}
                  variant="secondary"
                >
                  Try again
                </Button>
              </div>
            ) : null}
            {!reminders.isPending &&
            !reminders.isError &&
            items.length === 0 ? (
              <div className="space-y-2 py-8">
                <Icon icon={Clock01Icon} tone="muted" />
                <p className="text-body-sm">
                  {view === "active"
                    ? "Nothing to remember yet"
                    : "No reminder history yet"}
                </p>
              </div>
            ) : null}
            {!reminders.isPending && !reminders.isError
              ? groups
                  .filter((group) => group.items.length > 0)
                  .map((group) => (
                    <div className="mt-4 space-y-2.5" key={group.title}>
                      <h3 className="text-caption text-muted-fg">
                        {group.title}
                      </h3>
                      <ul className="space-y-3">
                        {group.items
                          .toSorted(
                            (left, right) =>
                              Date.parse(left.dueAt) - Date.parse(right.dueAt)
                          )
                          .map((reminder) => (
                            <ReminderItem
                              demo={demo}
                              key={reminder.id}
                              now={reminders.now}
                              onDetails={() => {
                                setDetails(reminder);
                              }}
                              onEdit={() => {
                                handleEdit(reminder);
                              }}
                              onOpen={() => {
                                open(reminder);
                              }}
                              reminder={reminder}
                            />
                          ))}
                      </ul>
                    </div>
                  ))
              : null}
          </>
        ) : null}
      </div>
      <ReminderDetails
        onClose={() => {
          setDetails(null);
          setRequestDismissed(true);
        }}
        onEdit={handleEdit}
        reminder={
          details ?? (requestDismissed ? null : (selected.data ?? null))
        }
      />
    </section>
  );
};
