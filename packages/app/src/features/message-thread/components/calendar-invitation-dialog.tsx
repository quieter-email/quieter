import { useMailboxSearchActions } from "@quieter/app/features/mailbox/components/mailbox-workspace/use-mailbox-route-search";
import { applyCalendarMutationReceipt } from "@quieter/app/lib/calendar-cache-lifecycle";
import {
  calendarAccountsQueryOptions,
  calendarCalendarsQueryOptions,
} from "@quieter/app/lib/calendar-query";
import { toastError } from "@quieter/app/lib/error-toast";
import { openGoogleAccountLink } from "@quieter/app/lib/google-account-link";
import type { MessageAttachment } from "@quieter/app/lib/mail";
import { mailboxesQueryOptions } from "@quieter/app/lib/mailboxes-query";
import { rpc } from "@quieter/app/lib/orpc";
import type { CalendarAccount } from "@quieter/calendar";
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
import { useLocation } from "@tanstack/react-router";
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
  const returnTo = useLocation({ select: (location) => location.href });
  const accounts = useQuery(calendarAccountsQueryOptions(userId));
  const mailboxes = useQuery(mailboxesQueryOptions());
  const sourceMailbox = mailboxes.data?.groups
    .flatMap((group) => group.mailboxes)
    .find((mailbox) => mailbox.id === mailboxId);
  const sourceGmailMailbox =
    sourceMailbox?.provider === "gmail" && sourceMailbox.ownerUserId === userId
      ? sourceMailbox
      : undefined;
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
  const [pendingAction, setPendingAction] = useState<
    { kind: "add" | "retry" } | { accountId: string; kind: "connect" } | null
  >(null);
  const pending = pendingAction !== null;
  const sourceAccount = accounts.data?.accounts.find(
    (account) => account.mailboxId === mailboxId
  );
  const sourceUpgradeMailbox =
    sourceAccount?.status === "connected" ? undefined : sourceGmailMailbox;
  const recoveryAccounts =
    accounts.data?.accounts.filter(
      (account) => account.status !== "connected"
    ) ?? [];
  const selected =
    destinations.find(
      (calendar) =>
        JSON.stringify([calendar.connectionId, calendar.calendarId]) === choice
    ) ??
    destinations.find(
      (calendar) =>
        calendar.connectionId === sourceAccount?.id && calendar.primary
    ) ??
    destinations.find(
      (calendar) => calendar.connectionId === sourceAccount?.id
    ) ??
    destinations.find((calendar) => calendar.primary) ??
    destinations.at(0);
  const loading =
    destinations.length === 0 &&
    (accounts.isPending || calendarQueries.some((query) => query.isPending));
  const failed =
    accounts.isError || calendarQueries.some((query) => query.isError);
  const retry = async () => {
    setPendingAction({ kind: "retry" });
    const results = await Promise.allSettled([
      ...(accounts.isError ? [accounts.refetch({ throwOnError: true })] : []),
      ...calendarQueries
        .filter((query) => query.isError)
        .map(async (query) => await query.refetch({ throwOnError: true })),
    ]);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") {
      toastError(failure.reason, { boundary: "calendar-invitation" });
    }
    setPendingAction(null);
  };
  const connect = async (account?: CalendarAccount) => {
    const accountId = account?.id ?? "new";
    setPendingAction({ accountId, kind: "connect" });
    try {
      await openGoogleAccountLink({
        loginHint: account
          ? (account.email ?? undefined)
          : sourceUpgradeMailbox?.emailAddress,
        mailboxId: account
          ? (account.mailboxId ?? undefined)
          : sourceUpgradeMailbox?.id,
        queryClient: client,
        returnTo,
      });
    } catch (error) {
      toastError(error, { boundary: "calendar-invitation" });
    } finally {
      setPendingAction(null);
    }
  };
  const add = async () => {
    if (!selected) {
      return;
    }
    setPendingAction({ kind: "add" });
    try {
      const result = await rpc.calendar.importInvitation({
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
      setPendingAction(null);
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
                disabled={pending || destinations.length === 0}
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
          {!loading && !failed && destinations.length === 0 ? (
            <Text size="caption" tone="muted">
              {connected.length > 0
                ? "This account has no editable calendars. Connect another Gmail account to add this invitation."
                : "Enable calendar access for a Gmail account to add this invitation."}
            </Text>
          ) : null}
          {failed ? (
            <div className="flex items-center justify-between gap-3">
              <Text size="caption" tone="muted">
                Some calendars could not be loaded.
              </Text>
              <Button
                disabled={pending}
                onClick={() => {
                  void retry();
                }}
                pending={pendingAction?.kind === "retry"}
                size="sm"
                variant="secondary"
              >
                Retry
              </Button>
            </div>
          ) : null}
          {recoveryAccounts.map((account) => {
            let actionLabel = "Connect Gmail";
            if (account.status === "needs-reconnect") {
              actionLabel = "Reconnect";
            } else if (account.status === "needs-permission") {
              actionLabel = "Enable calendar";
            }
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-3"
                key={account.id}
              >
                <div className="min-w-0 flex-1">
                  <Text size="sm" truncate>
                    {account.email ?? account.name}
                  </Text>
                  <Text size="caption" tone="muted">
                    {account.status === "needs-reconnect"
                      ? "Reconnect to restore calendar access."
                      : "Allow calendar access by connecting this account through Gmail."}
                  </Text>
                </div>
                <Button
                  disabled={pending}
                  onClick={() => {
                    void connect(account);
                  }}
                  pending={
                    pendingAction?.kind === "connect" &&
                    pendingAction.accountId === account.id
                  }
                  pendingLabel="Opening Google"
                  size="sm"
                  variant="secondary"
                >
                  {actionLabel}
                </Button>
              </div>
            );
          })}
          {!loading &&
          !accounts.isError &&
          destinations.length === 0 &&
          recoveryAccounts.length === 0 ? (
            <Button
              disabled={pending || mailboxes.isPending}
              onClick={() => {
                void connect();
              }}
              pending={
                pendingAction?.kind === "connect" &&
                pendingAction.accountId === "new"
              }
              pendingLabel="Opening Google"
              variant="secondary"
            >
              {sourceUpgradeMailbox ? "Enable calendar" : "Connect Gmail"}
            </Button>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <DialogCloseButton disabled={pending}>Cancel</DialogCloseButton>
          <Button
            disabled={!selected || pending}
            onClick={() => {
              void add();
            }}
            pending={pendingAction?.kind === "add"}
          >
            Add invitation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
