"use client";

import { toastError } from "@quieter/app/lib/error-toast";
import { isSandboxMailboxId } from "@quieter/app/lib/sandbox-mailbox";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import {
  MAIL_SNOOZE_LIVE_STATUSES,
  mailSnoozeCommandSchema,
} from "@quieter/mail/snooze";
import type { MailSnoozeCommand, MailSnoozeState } from "@quieter/mail/snooze";
import { Button } from "@quieter/ui/button";
import { DatePicker } from "@quieter/ui/date-picker";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Text } from "@quieter/ui/text";
import { TimePicker } from "@quieter/ui/time-picker";
import { toast } from "@quieter/ui/toast";
import { useRef, useState } from "react";
import type { SubmitEvent } from "react";

import { CalendarTimeZonePicker } from "../../calendar/components/calendar-time-zone-picker";
import { getReminderPresetTime } from "../../reminders/reminder-time";

export const snoozeLiveStatuses = new Set<MailSnoozeState["status"]>(
  MAIL_SNOOZE_LIVE_STATUSES
);

const snoozeStatusLabels: Record<MailSnoozeState["status"], string> = {
  active: "Returns",
  cancelled: "Return cancelled, was due",
  failed: "Could not return",
  preparing: "Preparing return",
  returned: "Returned, was due",
  returning: "Returning",
  superseded: "Return stopped, was due",
  suspended: "Return paused",
  uncertain: "Return needs attention",
};

export const MailSnoozeStatus = ({ snooze }: { snooze: MailSnoozeState }) => (
  <Text as="p" size="caption" tone="muted">
    {snooze.status === "active" && isSandboxMailboxId(snooze.mailboxId)
      ? "Preview return"
      : snoozeStatusLabels[snooze.status]}{" "}
    {new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: snooze.timeZone,
    }).format(new Date(snooze.returnAt))}{" "}
    ({snooze.timeZone}){snooze.message ? `, ${snooze.message}` : ""}
  </Text>
);

type MailSnoozeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (
    command: MailSnoozeCommand,
    expectedVersion: number | null
  ) => Promise<void>;
  initial?: MailSnoozeState;
  reschedule?: boolean;
  shared?: boolean;
  preview?: boolean;
};

const MailSnoozeEditor = ({
  onApply,
  onOpenChange,
  initial,
  reschedule = false,
  shared = false,
  preview = false,
  pending,
  onPendingChange,
}: MailSnoozeDialogProps & {
  pending: boolean;
  onPendingChange: (pending: boolean) => void;
}) => {
  const expectedVersion = useRef(initial?.version ?? null);
  const [timeZone, setTimeZone] = useState(
    initial?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  );
  const [local, setLocal] = useState(() =>
    getZonedDateTimeFields({
      instant:
        reschedule && initial
          ? initial.returnAt
          : getReminderPresetTime({ days: 1, timeZone }),
      timeZone,
    })
  );
  const [validationError, setValidationError] = useState<string | null>(null);
  const submitLabel = reschedule ? "Save return time" : "Snooze";
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    let returnAt: string;
    try {
      returnAt = calendarWallTimeToInstant({
        date: local.date,
        disambiguation: "reject",
        time: local.time,
        timeZone,
      });
    } catch {
      setValidationError(
        "This local time is missing or occurs twice because the clocks change. Choose a different time."
      );
      return;
    }
    const parsed = mailSnoozeCommandSchema.safeParse({
      kind: reschedule ? "reschedule" : "snooze",
      returnAt,
      timeZone,
    });
    if (!parsed.success) {
      setValidationError(
        parsed.error.issues[0]?.message ?? "Check the return time."
      );
      return;
    }
    if (new Date(returnAt).getTime() <= Date.now()) {
      setValidationError("Choose a time in the future.");
      return;
    }
    setValidationError(null);
    onPendingChange(true);
    try {
      await onApply(parsed.data, expectedVersion.current);
      toast.success(
        reschedule ? "Return time updated." : "Conversation snoozed."
      );
      onOpenChange(false);
    } catch (error) {
      toastError(error, {
        boundary: "mail-snooze",
        fallback: "Could not update the return time. Try again.",
      });
    } finally {
      onPendingChange(false);
    }
  };
  return (
    <form
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <DialogHeader>
        <DialogTitle>
          {reschedule ? "Change return time" : "Snooze conversation"}
        </DialogTitle>
        <DialogDescription>
          {shared
            ? "Return to Inbox for everyone at this time. A new reply returns it sooner."
            : "Return to Inbox at this time. A new reply returns it sooner."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody spacing="3">
        {preview ? (
          <Text as="p" size="caption" tone="muted">
            This preview saves your return time. Automatic returns run only in
            connected inboxes; use Return to Inbox here.
          </Text>
        ) : null}
        <div className="flex flex-wrap gap-1">
          {(
            [
              { days: 1, label: "Tomorrow morning" },
              { days: 7, label: "Next week" },
            ] as const
          ).map((preset) => {
            const fields = getZonedDateTimeFields({
              instant: getReminderPresetTime({ days: preset.days, timeZone }),
              timeZone,
            });
            return (
              <Button
                aria-pressed={
                  fields.date === local.date && fields.time === local.time
                }
                disabled={pending}
                key={preset.days}
                onClick={() => {
                  setLocal(fields);
                }}
                size="sm"
                type="button"
                variant="option"
              >
                {preset.label}
              </Button>
            );
          })}
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <DatePicker
              aria-label="Return date"
              disabled={pending}
              onValueChange={(date) => {
                setLocal((value) => ({ ...value, date }));
              }}
              required
              value={local.date}
            />
          </div>
          <div className="w-28 shrink-0">
            <TimePicker
              aria-label="Return time"
              disabled={pending}
              onValueChange={(time) => {
                setLocal((value) => ({ ...value, time }));
              }}
              required
              value={local.time}
            />
          </div>
        </div>
        <div className="justify-self-start">
          <CalendarTimeZonePicker
            aria-label="Return time zone"
            disabled={pending}
            onValueChange={setTimeZone}
            size="sm"
            value={timeZone}
            variant="ghost"
          />
        </div>
        <Text as="p" size="caption" tone="muted">
          Time zone: {timeZone}
        </Text>
        {validationError ? (
          <Text as="p" role="alert" size="caption" tone="destructive">
            {validationError}
          </Text>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button
          disabled={pending}
          onClick={() => {
            onOpenChange(false);
          }}
          type="button"
          variant="secondary"
        >
          Cancel
        </Button>
        <Button disabled={pending} type="submit">
          {pending ? "Saving…" : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
};

export const MailSnoozeDialog = (props: MailSnoozeDialogProps) => {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      onOpenChange={(open) => {
        if (!pending) {
          props.onOpenChange(open);
        }
      }}
      open={props.open}
    >
      <DialogContent>
        <MailSnoozeEditor
          {...props}
          key={props.open ? "open" : "closed"}
          onPendingChange={setPending}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  );
};
