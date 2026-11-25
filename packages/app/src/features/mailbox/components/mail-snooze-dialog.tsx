"use client";

import { AlarmClockIcon } from "@hugeicons/core-free-icons";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  calendarWallTimeToInstant,
  getZonedDateTimeFields,
} from "@quieter/calendar/time";
import { mailSnoozeCommandSchema } from "@quieter/mail/snooze";
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
import { Icon } from "@quieter/ui/icon";
import { Pill } from "@quieter/ui/pill";
import type { PillTone } from "@quieter/ui/pill";
import { Text } from "@quieter/ui/text";
import { TimePicker } from "@quieter/ui/time-picker";
import { toast } from "@quieter/ui/toast";
import { useRef, useState } from "react";
import type { SubmitEvent } from "react";

import { CalendarTimeZonePicker } from "../../calendar/components/calendar-time-zone-picker";
import { getReminderPresetTime } from "../../reminders/reminder-time";
import {
  getMailSnoozeRowLabel,
  getMailSnoozeStatusText,
  resumeMailSnoozeAttempt,
} from "../domain/mail-snooze";
import type { MailSnoozeAttempt } from "../domain/mail-snooze";

export const MailSnoozeStatus = ({ snooze }: { snooze: MailSnoozeState }) => (
  <Text as="span" size="caption" tone="muted">
    {getMailSnoozeStatusText(snooze)}
  </Text>
);

const rowStatusTones: Partial<Record<MailSnoozeState["status"], PillTone>> = {
  failed: "destructive",
  suspended: "orange",
  uncertain: "orange",
};

// The row's open button announces the full status.
export const MailSnoozeRowStatus = ({
  snooze,
}: {
  snooze: MailSnoozeState;
}) => (
  <Pill aria-hidden size="xs" tone={rowStatusTones[snooze.status] ?? "neutral"}>
    <span className="inline-flex items-center gap-1 tabular-nums">
      <Icon aria-hidden icon={AlarmClockIcon} size={12} />
      {getMailSnoozeRowLabel(snooze)}
    </span>
  </Pill>
);

type MailSnoozeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (
    command: MailSnoozeCommand,
    expectedVersion: number | null,
    attempt: MailSnoozeAttempt
  ) => Promise<void>;
  onApplied?: (command: MailSnoozeCommand) => void;
  initial?: MailSnoozeState;
  reschedule?: boolean;
  shared?: boolean;
  preview?: boolean;
};

const MailSnoozeEditor = ({
  onApply,
  onApplied,
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
  const attempt = useRef<MailSnoozeAttempt>(new Map());
  const [retryCommand, setRetryCommand] = useState<MailSnoozeCommand | null>(
    null
  );
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
  const inputsDisabled = pending || retryCommand !== null;
  const defaultSubmitLabel = reschedule ? "Save return time" : "Snooze";
  const submitLabel = retryCommand === null ? defaultSubmitLabel : "Try again";
  const runAttempt = async (command: MailSnoozeCommand) => {
    onPendingChange(true);
    try {
      if (retryCommand === null) {
        await onApply(command, expectedVersion.current, attempt.current);
      } else {
        await resumeMailSnoozeAttempt(attempt.current);
      }
      toast.success(
        reschedule ? "Return time updated." : "Conversation snoozed."
      );
      onOpenChange(false);
      onApplied?.(command);
    } catch (error) {
      setRetryCommand(attempt.current.size > 0 ? command : null);
      toastError(error, {
        boundary: "mail-snooze",
        fallback: "Could not update the return time. Try again.",
      });
    } finally {
      onPendingChange(false);
    }
  };
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (retryCommand !== null) {
      await runAttempt(retryCommand);
      return;
    }
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
    await runAttempt(parsed.data);
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
                disabled={inputsDisabled}
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
              disabled={inputsDisabled}
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
              disabled={inputsDisabled}
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
            disabled={inputsDisabled}
            onValueChange={setTimeZone}
            size="sm"
            value={timeZone}
            variant="ghost"
          />
        </div>
        {retryCommand === null ? null : (
          <Text as="p" role="alert" size="caption" tone="muted">
            Some changes are not confirmed. Try again to finish with the same
            return time, or cancel and start over.
          </Text>
        )}
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
