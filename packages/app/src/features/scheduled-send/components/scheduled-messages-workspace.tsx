"use client";

import {
  Clock01Icon,
  Loading03Icon,
  Refresh01Icon,
} from "@hugeicons/core-free-icons";
import { EmptyMessageState } from "@quieter/app/components/empty-message-state";
import { ScheduleSendEditor } from "@quieter/app/features/compose/components/schedule-send-picker";
import { MailSubviewHeader } from "@quieter/app/features/mailbox/components/mail-subview-header";
import { toastError } from "@quieter/app/lib/error-toast";
import { refreshCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/index";
import { orpc } from "@quieter/app/lib/orpc";
import type { RouterOutputs } from "@quieter/orpc";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Pill } from "@quieter/ui/pill";
import { Text } from "@quieter/ui/text";
import { toast } from "@quieter/ui/toast";
import {
  WorkspaceHeader,
  WorkspaceSection,
} from "@quieter/ui/workspace-section";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

type ScheduledMessage = Pick<
  RouterOutputs["scheduledSends"]["list"][number],
  "id" | "subject" | "to" | "sendAt" | "timeZone" | "status" | "errorMessage"
>;

const scheduledStatusLabels = {
  cancelled: "Canceled",
  failed: "Needs attention",
  preparing: "Preparing",
  scheduled: "Scheduled",
  sending: "Sending",
  sent: "Sent",
  uncertain: "Checking delivery",
} satisfies Record<ScheduledMessage["status"], string>;

export const ScheduledMessagesWorkspace = ({
  demo,
  mailboxId,
  onOpenSidebar,
}: {
  demo: boolean;
  mailboxId: string;
  onOpenSidebar: () => void;
}) => {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  // oxlint-disable-next-line react/hook-use-state -- Preview examples keep their initial send dates.
  const [demoMessages] = useState<ScheduledMessage[]>(() => {
    if (!demo) {
      return [];
    }
    const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);
    const nextWeek = new Date(tomorrow);
    nextWeek.setDate(nextWeek.getDate() + 7);
    return [
      {
        errorMessage: null,
        id: "demo-scheduled-proposal",
        sendAt: tomorrow.toISOString(),
        status: "scheduled",
        subject: "A few thoughts on the proposal",
        timeZone,
        to: "Alex <alex@example.com>",
      },
      {
        errorMessage: null,
        id: "demo-scheduled-check-in",
        sendAt: nextWeek.toISOString(),
        status: "scheduled",
        subject: "Checking in next week",
        timeZone,
        to: "Sam <sam@example.com>",
      },
    ];
  });
  const listOptions = orpc.scheduledSends.list.queryOptions({
    input: { mailboxId },
  });
  const messagesQuery = useQuery({
    ...listOptions,
    enabled: !demo,
    refetchInterval: 15_000,
  });
  const cancelMutation = useMutation({
    ...orpc.scheduledSends.cancel.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "scheduled-send-cancel" });
    },
    onSuccess: async () => {
      toast.success("Scheduled send canceled. Message returned to Drafts.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: listOptions.queryKey }),
        refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
      ]);
    },
  });
  const rescheduleMutation = useMutation({
    ...orpc.scheduledSends.reschedule.mutationOptions(),
    onError: (error) => {
      toastError(error, { boundary: "scheduled-send-reschedule" });
    },
    onSuccess: async () => {
      setEditing(null);
      toast.success("Send time updated.");
      await queryClient.invalidateQueries({ queryKey: listOptions.queryKey });
    },
  });
  const pending = cancelMutation.isPending || rescheduleMutation.isPending;
  const messages = demo ? demoMessages : (messagesQuery.data ?? []);
  const refreshMessages = async () => {
    const result = await messagesQuery.refetch();
    if (result.error) {
      toastError(result.error, { boundary: "scheduled-send-refresh" });
    }
  };

  return (
    <>
      <WorkspaceSection aria-label="Scheduled messages">
        <WorkspaceHeader>
          <MailSubviewHeader onOpenSidebar={onOpenSidebar} title="Scheduled">
            <IconButtonTooltip label="Refresh scheduled messages">
              <Button
                aria-label="Refresh scheduled messages"
                chrome="toolbar"
                disabled={demo || messagesQuery.isFetching}
                onClick={() => {
                  void refreshMessages();
                }}
                size="icon"
                type="button"
                variant="toolbar"
              >
                <Icon
                  animation={messagesQuery.isFetching ? "spin" : undefined}
                  icon={Refresh01Icon}
                />
              </Button>
            </IconButtonTooltip>
          </MailSubviewHeader>
        </WorkspaceHeader>
        {!demo && messagesQuery.isPending ? (
          <output className="flex flex-1 items-center justify-center gap-2">
            <Icon animation="spin" icon={Loading03Icon} tone="muted" />
            <Text size="sm" tone="muted">
              Loading scheduled messages…
            </Text>
          </output>
        ) : null}
        {!demo && messagesQuery.isError && messages.length === 0 ? (
          <EmptyMessageState
            action={
              <Button
                onClick={() => {
                  void refreshMessages();
                }}
                type="button"
              >
                Try again
              </Button>
            }
            description="Please try again."
            title="Could not load scheduled messages"
          />
        ) : null}
        {(demo || messagesQuery.isSuccess) && messages.length === 0 ? (
          <EmptyMessageState
            title="No scheduled messages"
            description="Choose Schedule send beside Send when you compose a message."
          />
        ) : null}
        {messages.length > 0 ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Text className="mx-4 mt-4" size="caption" tone="muted">
              Messages send automatically, even when Quieter is closed.
              Canceling returns them to Drafts.
            </Text>
            <ul className="flex flex-col">
              {messages.map((message) => {
                const canReschedule = message.status === "scheduled";
                const canCancel =
                  message.status === "scheduled" ||
                  message.status === "failed" ||
                  message.status === "cancelled";
                return (
                  <li
                    className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4"
                    key={message.id}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <Icon
                        className="mt-0.5 shrink-0"
                        icon={Clock01Icon}
                        tone="muted"
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Text
                          as="h2"
                          size="sm"
                          title={message.subject}
                          truncate
                        >
                          {message.subject || "(No subject)"}
                        </Text>
                        <Text
                          size="caption"
                          title={message.to}
                          tone="muted"
                          truncate
                        >
                          To {message.to}
                        </Text>
                        <Text size="caption" tone="muted">
                          <time dateTime={message.sendAt}>
                            {new Intl.DateTimeFormat(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short",
                              timeZone: message.timeZone,
                            }).format(new Date(message.sendAt))}
                          </time>
                          {", "}
                          {message.timeZone}
                        </Text>
                        {message.status === "scheduled" ? null : (
                          <Pill
                            size="xs"
                            tone={
                              message.status === "failed"
                                ? "destructive"
                                : "neutral"
                            }
                          >
                            {scheduledStatusLabels[message.status]}
                          </Pill>
                        )}
                        {message.errorMessage ? (
                          <Text size="caption" tone="destructive">
                            {message.errorMessage}
                          </Text>
                        ) : null}
                        {message.status === "uncertain" ? (
                          <Text size="caption" tone="muted">
                            Check Sent before sending another copy.
                          </Text>
                        ) : null}
                      </div>
                    </div>
                    {canReschedule || canCancel ? (
                      <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
                        {canReschedule ? (
                          <Button
                            disabled={pending || demo}
                            onClick={() => {
                              setEditing(message);
                            }}
                            size="sm"
                            type="button"
                            variant="secondary"
                          >
                            Reschedule
                          </Button>
                        ) : null}
                        {canCancel ? (
                          <Button
                            disabled={pending || demo}
                            onClick={() => {
                              cancelMutation.mutate({
                                id: message.id,
                                mailboxId,
                              });
                            }}
                            size="sm"
                            title="Cancel send and return to Drafts"
                            type="button"
                            variant="secondary"
                          >
                            {message.status === "cancelled"
                              ? "Return to drafts"
                              : "Cancel send"}
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </WorkspaceSection>
      <Dialog
        onOpenChange={(open) => {
          if (!open && !rescheduleMutation.isPending) {
            setEditing(null);
          }
        }}
        open={editing !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reschedule send</DialogTitle>
          </DialogHeader>
          <DialogBody>
            {editing ? (
              <ScheduleSendEditor
                initial={{ sendAt: editing.sendAt, timeZone: editing.timeZone }}
                key={editing.id}
                onCancel={() => {
                  setEditing(null);
                }}
                onConfirm={(value) => {
                  rescheduleMutation.mutate({
                    ...value,
                    id: editing.id,
                    mailboxId,
                  });
                }}
                pending={rescheduleMutation.isPending}
                submitLabel="Save send time"
              />
            ) : null}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};
