"use client";

import {
  Calendar03Icon,
  Clock01Icon,
  Undo02Icon,
} from "@hugeicons/core-free-icons";
import { ScheduleSendEditor } from "@quieter/app/features/compose/components/schedule-send-picker";
import {
  appEaseOut,
  appMotionDuration,
} from "@quieter/app/features/motion/app-motion";
import { toastError } from "@quieter/app/lib/error-toast";
import { parseSender } from "@quieter/app/lib/gmail/message-utils";
import { refreshCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/index";
import { orpc } from "@quieter/app/lib/orpc";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import {
  MailListRowDetails,
  mailListRowFrameVariants,
  mailListRowParts,
} from "@quieter/ui/mail-list-row";
import { Pill } from "@quieter/ui/pill";
import { SenderAvatar } from "@quieter/ui/sender-avatar";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query";
import { m } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import { getDemoScheduledMessages } from "../domain/demo-scheduled-messages";
import type { ScheduledMessage } from "../domain/demo-scheduled-messages";

export type ScheduledSentSource = {
  badge?: ReactNode;
  demo: boolean;
  emailAddress?: string;
  mailboxId: string;
};

type ScheduledEntry = {
  message: ScheduledMessage;
  source: ScheduledSentSource;
};

const scheduledStatusLabels = {
  cancelled: "Canceled",
  failed: "Needs attention",
  preparing: "Preparing",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  uncertain: "Checking delivery",
} satisfies Record<ScheduledMessage["status"], string>;

const getScheduledActions = (message: ScheduledMessage) => {
  const undoHeld = message.deliveryKind === "undo";
  const canReschedule = !undoHeld && message.status === "scheduled";
  const canCancel =
    (message.status === "scheduled" && (!undoHeld || message.canUndo)) ||
    message.status === "preparing" ||
    message.status === "failed" ||
    message.status === "cancelled";
  let statusLabel: string | null =
    message.status === "scheduled"
      ? null
      : scheduledStatusLabels[message.status];
  if (undoHeld && message.status === "scheduled") {
    if (message.errorMessage === null) {
      statusLabel = message.canUndo ? "Held" : "Sending";
    } else {
      statusLabel = "Retrying";
    }
  }
  let cancelLabel = "Cancel send";
  if (message.status === "cancelled" || message.status === "failed") {
    cancelLabel = "Return to Drafts";
  } else if (undoHeld) {
    cancelLabel = "Undo send";
  }
  return { canCancel, canReschedule, cancelLabel, statusLabel, undoHeld };
};

const formatSendTime = (message: ScheduledMessage, viewerTimeZone: string) => {
  const undoHeld = message.deliveryKind === "undo";
  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: undoHeld ? undefined : message.timeZone,
  }).format(new Date(message.sendAt));
  return undoHeld || message.timeZone === viewerTimeZone
    ? formatted
    : `${formatted}, ${message.timeZone}`;
};

const ScheduledSentRow = ({
  entry,
  onOpen,
  onReschedule,
  onCancel,
  pending,
  viewerTimeZone,
}: {
  entry: ScheduledEntry;
  onCancel: () => void;
  onOpen: () => void;
  onReschedule: () => void;
  pending: boolean;
  viewerTimeZone: string;
}) => {
  const [hovered, setHovered] = useState(false);
  const { message, source } = entry;
  const recipient = parseSender(
    splitMailAddressList(message.to)[0] ?? message.to
  );
  const recipientLabel =
    recipient.name || recipient.email || recipient.display || "No recipients";
  const subject = message.subject.trim() || "(No subject)";
  const sendTime = formatSendTime(message, viewerTimeZone);
  const { canCancel, canReschedule, cancelLabel, statusLabel } =
    getScheduledActions(message);
  const disabled = pending || source.demo;
  const sourceLabel = source.emailAddress ? `, in ${source.emailAddress}` : "";
  const actions =
    canReschedule || canCancel ? (
      <>
        {canReschedule ? (
          <IconButtonTooltip label="Reschedule">
            <Button
              aria-label={`Reschedule ${subject}`}
              disabled={disabled}
              fullWidth
              onClick={onReschedule}
              size="xs"
              type="button"
              variant="row-action"
            >
              <Icon aria-hidden icon={Calendar03Icon} />
            </Button>
          </IconButtonTooltip>
        ) : null}
        {canCancel ? (
          <IconButtonTooltip label={cancelLabel}>
            <Button
              aria-label={`${cancelLabel}: ${subject}`}
              disabled={disabled}
              fullWidth
              onClick={onCancel}
              size="xs"
              type="button"
              variant="row-action"
            >
              <Icon aria-hidden icon={Undo02Icon} />
            </Button>
          </IconButtonTooltip>
        ) : null}
      </>
    ) : undefined;

  return (
    <li className="relative" data-scheduled-send-id={message.id}>
      <div
        className={mailListRowFrameVariants({ lines: "three" })}
        onMouseEnter={() => {
          setHovered(true);
        }}
        onMouseLeave={() => {
          setHovered(false);
        }}
      >
        <m.span
          animate={{ opacity: hovered ? 0.65 : 0 }}
          aria-hidden
          className={mailListRowParts.listOverlay}
          initial={false}
          transition={{
            duration: appMotionDuration.feedback,
            ease: appEaseOut,
          }}
        />
        <div aria-hidden className={mailListRowParts.selectionCell}>
          <span className="flex size-9.5 items-center justify-center">
            <SenderAvatar
              fallbackLabel={(
                recipientLabel.trim().charAt(0) || "?"
              ).toUpperCase()}
              size="xs"
            />
          </span>
        </div>
        <div className="relative h-full min-w-0 flex-1">
          <button
            aria-label={`Scheduled message: ${subject}, to ${recipientLabel}, sends ${sendTime}${statusLabel === null ? "" : `, ${statusLabel}`}${sourceLabel}`}
            className={mailListRowParts.trigger}
            onClick={onOpen}
            type="button"
          />
          <MailListRowDetails
            actions={actions}
            badge={source.badge}
            footer={
              <>
                <Icon aria-hidden icon={Clock01Icon} size={12} tone="muted" />
                <time
                  className="min-w-0 truncate"
                  dateTime={message.sendAt}
                  title={sendTime}
                >
                  {sendTime}
                </time>
              </>
            }
            inset="balanced"
            metadata={
              statusLabel === null ? undefined : (
                <Pill
                  size="xs"
                  tone={message.status === "failed" ? "destructive" : "neutral"}
                >
                  {statusLabel}
                </Pill>
              )
            }
            sender={recipientLabel}
            senderEmail={recipient.name ? recipient.email : ""}
            senderPrefix="To "
            subject={subject}
            timestamp={null}
          />
        </div>
      </div>
    </li>
  );
};

export const ScheduledSentRows = ({
  sources,
}: {
  sources: readonly ScheduledSentSource[];
}) => {
  const queryClient = useQueryClient();
  // oxlint-disable-next-line react/hook-use-state -- Preview examples keep their initial send dates.
  const [demoMessages] = useState(getDemoScheduledMessages);
  const { timeZone: viewerTimeZone } = Intl.DateTimeFormat().resolvedOptions();
  const [selected, setSelected] = useState<{
    id: string;
    mailboxId: string;
    rescheduling: boolean;
  } | null>(null);
  const queries = useQueries({
    queries: sources.map((source) => ({
      ...orpc.scheduledSends.list.queryOptions({
        input: { mailboxId: source.mailboxId },
      }),
      enabled: !source.demo,
      refetchInterval: (query: { state: { data?: ScheduledMessage[] } }) =>
        query.state.data?.some(
          (message) =>
            message.deliveryKind === "undo" &&
            (message.status === "preparing" ||
              message.status === "scheduled" ||
              message.status === "sending")
        ) === true
          ? 1000
          : 15_000,
    })),
  });
  const entries = sources
    .flatMap((source, index): ScheduledEntry[] => {
      if (source.demo) {
        return demoMessages.map((message) => ({ message, source }));
      }
      return (queries[index]?.data ?? []).map((message) => ({
        message,
        source,
      }));
    })
    .toSorted(
      (left, right) =>
        left.message.sendAt.localeCompare(right.message.sendAt) ||
        left.message.id.localeCompare(right.message.id)
    );

  // Messages leave the list once delivered, so refresh Sent to show them there.
  const deliveringIdsRef = useRef(new Map<string, Set<string>>());
  useEffect(() => {
    for (const [index, source] of sources.entries()) {
      const data = queries[index]?.data;
      if (source.demo || data === undefined) {
        continue;
      }
      const previous = deliveringIdsRef.current.get(source.mailboxId);
      const current = new Set(
        data
          .filter(
            (message) =>
              message.status === "preparing" ||
              message.status === "scheduled" ||
              message.status === "sending" ||
              message.status === "uncertain"
          )
          .map((message) => message.id)
      );
      deliveringIdsRef.current.set(source.mailboxId, current);
      const listedIds = new Set(data.map((message) => message.id));
      if (
        previous !== undefined &&
        [...previous].some((id) => !listedIds.has(id))
      ) {
        void (async () => {
          try {
            await refreshCachedMailboxQueries(
              queryClient,
              source.mailboxId,
              "sent"
            );
          } catch (error) {
            toastError(error, { boundary: "scheduled-send-sent-refresh" });
          }
        })();
      }
    }
  }, [queries, queryClient, sources]);

  const invalidateList = async (mailboxId: string) => {
    await queryClient.invalidateQueries({
      queryKey: orpc.scheduledSends.list.queryOptions({
        input: { mailboxId },
      }).queryKey,
    });
  };
  const cancelMutation = useMutation({
    ...orpc.scheduledSends.cancel.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "scheduled-send-cancel" });
    },
    onSuccess: async (_data, variables) => {
      deliveringIdsRef.current.get(variables.mailboxId)?.delete(variables.id);
      setSelected(null);
      toast.success("Sending canceled. Message returned to Drafts.");
      await Promise.all([
        invalidateList(variables.mailboxId),
        refreshCachedMailboxQueries(queryClient, variables.mailboxId, "drafts"),
      ]);
    },
  });
  const rescheduleMutation = useMutation({
    ...orpc.scheduledSends.reschedule.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "scheduled-send-reschedule" });
    },
    onSuccess: async (_data, variables) => {
      setSelected(null);
      toast.success("Send time updated.");
      await invalidateList(variables.mailboxId);
    },
  });
  const pending = cancelMutation.isPending || rescheduleMutation.isPending;
  const cancel = (entry: ScheduledEntry) => {
    if (entry.source.demo) {
      return;
    }
    cancelMutation.mutate({
      id: entry.message.id,
      mailboxId: entry.source.mailboxId,
    });
  };

  const selectedEntry = entries.find(
    ({ message, source }) =>
      message.id === selected?.id && source.mailboxId === selected.mailboxId
  );
  const selectedMessage = selectedEntry?.message;
  const selectedActions =
    selectedMessage === undefined ? null : getScheduledActions(selectedMessage);
  const rescheduling =
    selected?.rescheduling === true && selectedActions?.canReschedule === true;

  return (
    <>
      {sources.map((source, index) => {
        const query = queries[index];
        if (source.demo || !query?.isError) {
          return null;
        }
        return (
          <div
            className="flex items-center justify-between gap-2 px-4 py-2"
            key={source.mailboxId}
          >
            <Text size="caption" tone="destructive">
              {source.emailAddress
                ? `Could not load scheduled messages for ${source.emailAddress}.`
                : "Could not load scheduled messages."}
            </Text>
            <Button
              disabled={query.isFetching}
              onClick={() => {
                void query.refetch();
              }}
              size="xs"
              type="button"
              variant="secondary"
            >
              Retry
            </Button>
          </div>
        );
      })}
      {entries.length > 0 && (
        <ul aria-label="Scheduled messages">
          {entries.map((entry) => (
            <ScheduledSentRow
              entry={entry}
              key={`${entry.source.mailboxId}:${entry.message.id}`}
              onCancel={() => {
                cancel(entry);
              }}
              onOpen={() => {
                setSelected({
                  id: entry.message.id,
                  mailboxId: entry.source.mailboxId,
                  rescheduling: false,
                });
              }}
              onReschedule={() => {
                setSelected({
                  id: entry.message.id,
                  mailboxId: entry.source.mailboxId,
                  rescheduling: true,
                });
              }}
              pending={pending}
              viewerTimeZone={viewerTimeZone}
            />
          ))}
        </ul>
      )}
      <Dialog
        onOpenChange={(open) => {
          if (!open && !pending) {
            setSelected(null);
          }
        }}
        open={selectedEntry !== undefined}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {rescheduling ? "Reschedule send" : "Scheduled message"}
            </DialogTitle>
          </DialogHeader>
          {selectedEntry !== undefined && rescheduling ? (
            <DialogBody>
              <ScheduleSendEditor
                initial={{
                  sendAt: selectedEntry.message.sendAt,
                  timeZone: selectedEntry.message.timeZone,
                }}
                key={selectedEntry.message.id}
                onCancel={() => {
                  setSelected(null);
                }}
                onConfirm={(value) => {
                  rescheduleMutation.mutate({
                    ...value,
                    id: selectedEntry.message.id,
                    mailboxId: selectedEntry.source.mailboxId,
                  });
                }}
                pending={rescheduleMutation.isPending}
                submitDisabled={selectedEntry.source.demo}
                submitLabel="Save send time"
              />
            </DialogBody>
          ) : null}
          {selected !== null &&
          selectedEntry !== undefined &&
          selectedMessage !== undefined &&
          selectedActions !== null &&
          !rescheduling ? (
            <>
              <DialogBody spacing="3">
                <div className="space-y-1">
                  <Text as="p" size="sm" truncate weight="medium">
                    {selectedMessage.subject.trim() || "(No subject)"}
                  </Text>
                  <Text
                    as="p"
                    size="caption"
                    title={selectedMessage.to}
                    tone="muted"
                    truncate
                  >
                    To {selectedMessage.to}
                  </Text>
                  <Text as="p" size="caption" tone="muted">
                    Scheduled for{" "}
                    <time dateTime={selectedMessage.sendAt}>
                      {formatSendTime(selectedMessage, viewerTimeZone)}
                    </time>
                  </Text>
                </div>
                {selectedActions.statusLabel === null ? null : (
                  <Pill
                    size="xs"
                    tone={
                      selectedMessage.status === "failed"
                        ? "destructive"
                        : "neutral"
                    }
                  >
                    {selectedActions.statusLabel}
                  </Pill>
                )}
                {selectedMessage.errorMessage ? (
                  <Text as="p" size="caption" tone="destructive">
                    {selectedMessage.errorMessage}
                  </Text>
                ) : null}
                {selectedMessage.status === "uncertain" ? (
                  <Text as="p" size="caption" tone="muted">
                    Check Sent before sending another copy.
                  </Text>
                ) : null}
                <Text as="p" size="caption" tone="muted">
                  {selectedActions.undoHeld
                    ? "Undo send is available only during its short hold."
                    : "Pending messages send automatically, even when Quieter is closed. Canceling returns a message to Drafts."}
                </Text>
              </DialogBody>
              <DialogFooter>
                {selectedActions.canCancel ? (
                  <Button
                    disabled={pending || selectedEntry.source.demo}
                    onClick={() => {
                      cancel(selectedEntry);
                    }}
                    type="button"
                    variant="secondary"
                  >
                    {selectedActions.cancelLabel}
                  </Button>
                ) : null}
                {selectedActions.canReschedule ? (
                  <Button
                    disabled={pending || selectedEntry.source.demo}
                    onClick={() => {
                      setSelected({ ...selected, rescheduling: true });
                    }}
                    type="button"
                  >
                    Reschedule
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setSelected(null);
                    }}
                    type="button"
                  >
                    Done
                  </Button>
                )}
              </DialogFooter>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
};
