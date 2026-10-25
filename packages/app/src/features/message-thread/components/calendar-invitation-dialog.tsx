import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { applyCalendarMutationReceipt } from "@quieter/app/lib/calendar-cache-lifecycle";
import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
} from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import type { MessageAttachment } from "@quieter/app/lib/mail";
import { rpc } from "@quieter/app/lib/orpc";
import { getZonedDateTimeFields } from "@quieter/calendar/time";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Field, FieldLabel } from "@quieter/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export const CalendarInvitationDialog = ({
  attachment,
  mailboxId,
  onClose,
  userId,
}: {
  attachment: MessageAttachment & { messageId: string };
  mailboxId: string;
  onClose: () => void;
  userId: string;
}) => {
  const client = useQueryClient();
  const setMailboxSearch = useMailboxSearchActions();
  const accounts = useQuery(calendarAccountsQueryOptions(userId));
  const connected =
    accounts.data?.accounts.filter(
      (account) => account.status === "connected"
    ) ?? [];
  const calendarQueries = useQueries({
    queries: connected.map((account) =>
      calendarCalendarsQueryOptions(userId, account.id)
    ),
  });
  const destinations = calendarQueries
    .flatMap((query) => query.data?.calendars ?? [])
    .filter(
      (calendar) => calendar.access === "owner" || calendar.access === "write"
    );
  const [choice, setChoice] = useState("");
  const [pending, setPending] = useState(false);
  const selected =
    destinations.find(
      (calendar) =>
        JSON.stringify([calendar.connectionId, calendar.calendarId]) === choice
    ) ??
    destinations.find((calendar) => calendar.primary) ??
    destinations.at(0);
  const loading =
    accounts.isPending || calendarQueries.some((query) => query.isPending);
  const failed =
    accounts.isError || calendarQueries.some((query) => query.isError);
  const add = async () => {
    if (!selected) {
      return;
    }
    setPending(true);
    try {
      const result = await rpc.connectors.addGoogleCalendarIcsAttachment({
        attachmentId: attachment.attachmentId,
        calendarId: selected.calendarId,
        connectionId: selected.connectionId,
        mailboxId,
        messageId: attachment.messageId,
      });
      const ref = {
        calendarId: result.calendarId,
        connectionId: result.connectionId,
        eventId: result.id,
      };
      const [read] = await Promise.allSettled([rpc.calendar.event(ref)]);
      const event = read.status === "fulfilled" ? read.value : undefined;
      await applyCalendarMutationReceipt(client, userId, {
        ...ref,
        action: "created",
        event,
        status: "success",
      });
      toast.success(`Added ${result.summary} to your calendar.`, {
        description: (
          <Button
            fullWidth
            size="sm"
            onClick={() => {
              const timeZone =
                event?.time.kind === "timed"
                  ? event.time.timeZone
                  : selected.timeZone;
              let date: string | undefined;
              if (event?.time.kind === "all-day") {
                date = event.time.startDate;
              } else if (event?.time.kind === "timed") {
                ({ date } = getZonedDateTimeFields({
                  instant: event.time.start,
                  timeZone,
                }));
              }
              void setMailboxSearch(
                {
                  calendarConnectionId: result.connectionId,
                  calendarDate: date,
                  calendarEventId: result.id,
                  calendarId: result.calendarId,
                  calendarTimeZone: timeZone,
                  workspace: "calendar",
                },
                { replace: false }
              );
            }}
          >
            Open calendar
          </Button>
        ),
      });
      onClose();
    } catch (error) {
      toastError(error, { boundary: "calendar-invitation" });
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add invitation</DialogTitle>
          <DialogDescription>
            Choose where to add {attachment.fileName}.
          </DialogDescription>
        </DialogHeader>
        <DialogBody spacing="4">
          <Field>
            <FieldLabel>Calendar</FieldLabel>
            <Select
              value={
                selected
                  ? JSON.stringify([selected.connectionId, selected.calendarId])
                  : null
              }
              onValueChange={(value) => {
                setChoice(value ?? "");
              }}
            >
              <SelectTrigger
                aria-label="Calendar"
                disabled={pending || loading || destinations.length === 0}
              >
                <SelectValue
                  placeholder={
                    loading ? "Loading calendars…" : "Choose a calendar"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((calendar) => (
                  <SelectItem
                    key={JSON.stringify([
                      calendar.connectionId,
                      calendar.calendarId,
                    ])}
                    value={JSON.stringify([
                      calendar.connectionId,
                      calendar.calendarId,
                    ])}
                  >
                    {calendar.name},{" "}
                    {connected.find(
                      (account) => account.id === calendar.connectionId
                    )?.email ?? "Connected account"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {!loading && destinations.length === 0 ? (
            <Text size="caption" tone="muted">
              Connect an account with an editable calendar to add this
              invitation.
            </Text>
          ) : null}
          {failed ? (
            <Text size="caption" tone="muted">
              Some calendars could not be loaded. Close this dialog and try
              again.
            </Text>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={pending}>Cancel</DialogCloseButton>
          <Button
            disabled={!selected || pending}
            onClick={() => {
              void add();
            }}
            pending={pending}
          >
            Add invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
