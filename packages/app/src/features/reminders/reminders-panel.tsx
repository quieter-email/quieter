"use client";

import {
  Add01Icon,
  ArrowLeft01Icon,
  Clock01Icon,
} from "@hugeicons/core-free-icons";
import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { toastError } from "@quieter/app/lib/error-toast";
import { rpc } from "@quieter/app/lib/orpc";
import { getZonedDateTimeFields } from "@quieter/calendar/time";
import type { Reminder, ReminderTarget } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
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
import { ReminderRowTime } from "./reminder-row-time";
import { getReminderPresetTime } from "./reminder-time";

export type ReminderOpenRequest =
  | { id: string; mailboxId: string; title: string; target: ReminderTarget }
  | { id: string; mailboxId: string; reminderId: string }
  | { id: string; mailboxId: string; reminder: Reminder };

type ReminderScreen =
  | { kind: "list" }
  | { kind: "detail"; reminderId: string }
  | { kind: "new"; initial: ReminderEditorValues; requestId: string }
  | { kind: "edit"; reminder: Reminder; requestId: string };

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
        <Button className="max-w-full" onClick={onOpen} variant="inline-edit">
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
  const [screen, setScreen] = useState<ReminderScreen>(() => {
    if (!request) {
      return { kind: "list" };
    }
    if ("reminder" in request) {
      return {
        kind: "edit",
        reminder: request.reminder,
        requestId: request.id,
      };
    }
    if ("reminderId" in request) {
      return { kind: "detail", reminderId: request.reminderId };
    }
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    return {
      initial: {
        dueAt: getReminderPresetTime({ days: 1, timeZone }),
        target: request.target,
        timeZone,
        title: request.title,
      },
      kind: "new",
      requestId: request.id,
    };
  });
  const reminders = useReminderList(mailboxId, view, demo);
  const selectedId = screen.kind === "detail" ? screen.reminderId : null;
  const selected = useQuery({
    enabled: selectedId !== null,
    queryFn: async ({ signal }) => {
      if (selectedId === null) {
        return null;
      }
      if (demo) {
        return (
          demoReminderSession
            .get(mailboxId)
            ?.find((item) => item.id === selectedId) ?? null
        );
      }
      return await rpc.reminders.get(
        { mailboxId, reminderId: selectedId },
        { signal }
      );
    },
    queryKey: ["reminders", mailboxId, mode, "detail", selectedId],
  });
  const save = useMutation({
    mutationFn: async (values: ReminderEditorValues) => {
      if (screen.kind === "edit") {
        return await changeUiReminder(
          {
            command: { kind: "edit", ...values },
            expectedVersion: screen.reminder.version,
            mailboxId,
            reminderId: screen.reminder.id,
          },
          demo
        );
      }
      return await createUiReminder(
        {
          ...values,
          mailboxId,
          requestId:
            screen.kind === "new" ? screen.requestId : crypto.randomUUID(),
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
      setScreen({ kind: "detail", reminderId: reminder.id });
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
    setScreen({
      kind: "edit",
      reminder,
      requestId: crypto.randomUUID(),
    });
  };
  const open = (reminder: Reminder) => {
    cacheReminder({ client, demo, reminder });
    setScreen({ kind: "detail", reminderId: reminder.id });
  };
  const openMail = (reminder: Reminder) => {
    if (reminder.target.kind === "thread") {
      void navigate({
        mailbox: "inbox",
        mailboxId,
        messageId: reminder.target.anchorMessageId,
        threadId: reminder.target.threadId,
        workspace: null,
      });
    }
  };
  return (
    <section aria-label="Reminders" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        {screen.kind === "list" ? (
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
        ) : (
          <Button
            disabled={save.isPending}
            onClick={() => {
              setScreen({ kind: "list" });
            }}
            size="sm"
            variant="ghost"
          >
            <Icon icon={ArrowLeft01Icon} />
            Reminders
          </Button>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {demo || screen.kind !== "list" ? null : (
            <ReminderOptions mailboxId={mailboxId} />
          )}
          {screen.kind === "detail" && selected.data ? (
            <ReminderActions
              demo={demo}
              onEdit={() => {
                if (selected.data) {
                  handleEdit(selected.data);
                }
              }}
              reminder={selected.data}
            />
          ) : null}
          {screen.kind === "list" ? (
            <Button
              onClick={() => {
                const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
                setScreen({
                  initial: {
                    dueAt: getReminderPresetTime({ days: 1, timeZone }),
                    target: { kind: "standalone" },
                    timeZone,
                    title: "",
                  },
                  kind: "new",
                  requestId: crypto.randomUUID(),
                });
              }}
            >
              <Icon icon={Add01Icon} />
              New
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {demo ? (
          <p className="mb-3 text-caption text-muted-fg">
            Demo reminders stay in this browser session.
          </p>
        ) : null}
        {screen.kind === "new" || screen.kind === "edit" ? (
          <div className="space-y-5">
            <Text as="h2" size="lg" weight="medium">
              {screen.kind === "edit" ? "Edit reminder" : "New reminder"}
            </Text>
            <ReminderEditor
              focusTitleOnOpen
              initial={
                screen.kind === "edit" ? screen.reminder : screen.initial
              }
              key={screen.requestId}
              mailboxId={mailboxId}
              onCancel={() => {
                setScreen(
                  screen.kind === "edit"
                    ? { kind: "detail", reminderId: screen.reminder.id }
                    : { kind: "list" }
                );
              }}
              onSave={({ title: nextTitle, dueAt, timeZone, target }) => {
                save.mutate({ dueAt, target, timeZone, title: nextTitle });
              }}
              pending={save.isPending}
              submitLabel={
                screen.kind === "edit" ? "Save changes" : "Set reminder"
              }
            />
          </div>
        ) : null}
        {screen.kind === "detail" && selected.isPending ? (
          <output className="block py-4 text-body-sm text-muted-fg">
            Loading reminder...
          </output>
        ) : null}
        {screen.kind === "detail" && selected.data ? (
          <ReminderDetails
            demo={demo}
            onEdit={handleEdit}
            onOpenMail={() => {
              if (selected.data) {
                openMail(selected.data);
              }
            }}
            reminder={selected.data}
          />
        ) : null}
        {screen.kind === "detail" && !selected.isPending && !selected.data ? (
          <div className="space-y-3 py-4" role="alert">
            <p className="text-body-sm">Could not load this reminder.</p>
            <Button
              onClick={() => {
                void selected.refetch();
              }}
              variant="secondary"
            >
              Try again
            </Button>
          </div>
        ) : null}
        {screen.kind === "list" ? (
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
                    <div
                      className="mt-5 space-y-2.5 first:mt-0"
                      key={group.title}
                    >
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
                                open(reminder);
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
    </section>
  );
};
