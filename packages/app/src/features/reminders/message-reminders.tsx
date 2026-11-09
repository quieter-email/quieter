"use client";

import {
  Cancel01Icon,
  Clock01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons";
import { AssistantSidebarContext } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { toastError } from "@quieter/app/lib/error-toast";
import type { MessageListItem } from "@quieter/app/lib/mail";
import { rpc } from "@quieter/app/lib/orpc";
import {
  isGmailSandboxMailboxId,
  isManagedSandboxMailboxId,
} from "@quieter/app/lib/sandbox-mailbox";
import type { Reminder } from "@quieter/mail/reminders";
import { Button } from "@quieter/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from "@quieter/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Surface } from "@quieter/ui/surface";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";

import { useQuickReminder } from "./quick-reminder";
import { ReminderSnoozeMenu } from "./reminder-actions";
import { ReminderEditor } from "./reminder-editor";
import { useReminderMutation, cacheReminder } from "./reminder-mutations";
import {
  reminderPreferencesOptions,
  useReminderClock,
  useReminderList,
} from "./reminder-query";

type MessageReminderProps = {
  mailboxId: string;
  message: Pick<MessageListItem, "id" | "threadId" | "subject">;
};

const ExistingMessageReminder = ({
  reminder,
  demo,
}: {
  reminder: Reminder;
  demo: boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const mutation = useReminderMutation({ demo, reminder });
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: reminder.timeZone,
  }).format(new Date(reminder.dueAt));
  return (
    <>
      <DropdownMenu>
        <IconButtonTooltip label={`Reminder set for ${date}`}>
          <DropdownMenuTrigger
            appearance="row-strong"
            aria-label={`Reminder set for ${date}`}
            disabled={mutation.isPending}
          >
            <Icon icon={Clock01Icon} />
            <span className="text-caption">{date}</span>
          </DropdownMenuTrigger>
        </IconButtonTooltip>
        <DropdownMenuContent align="end">
          <ReminderSnoozeMenu
            demo={demo}
            onCustom={() => {
              setEditing(true);
            }}
            reminder={reminder}
          />
          <DropdownMenuItem
            onSelect={() => {
              setEditing(true);
            }}
          >
            Edit reminder
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              mutation.mutate({ kind: "cancel" });
            }}
            tone="destructive"
          >
            Cancel reminder
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setEditing} open={editing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit reminder</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <ReminderEditor
              initial={reminder}
              key={`${reminder.id}:${reminder.version}:${editing}`}
              onCancel={() => {
                setEditing(false);
              }}
              onSave={({ title, dueAt, timeZone, target }) => {
                mutation.mutate(
                  { dueAt, kind: "edit", target, timeZone, title },
                  {
                    onSuccess: () => {
                      setEditing(false);
                    },
                  }
                );
              }}
              pending={mutation.isPending}
            />
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  );
};

export const MessageReminderQuickAction = ({
  mailboxId,
  message,
}: MessageReminderProps) => {
  const sidebar = use(AssistantSidebarContext);
  const demo =
    isGmailSandboxMailboxId(mailboxId) || isManagedSandboxMailboxId(mailboxId);
  const reminders = useReminderList(mailboxId, "active", demo);
  const quick = useQuickReminder({ mailboxId, message });
  const existing = reminders.data?.items.find(
    (item) =>
      item.status === "active" &&
      item.target.kind === "thread" &&
      item.target.threadId === message.threadId
  );
  if (existing) {
    return <ExistingMessageReminder demo={demo} reminder={existing} />;
  }
  return (
    <DropdownMenu>
      <IconButtonTooltip label="Remind me">
        <DropdownMenuTrigger
          appearance="icon"
          chrome="toolbar"
          aria-label="Remind me"
          disabled={quick.isPending || reminders.isPending}
        >
          <Icon icon={Clock01Icon} />
        </DropdownMenuTrigger>
      </IconButtonTooltip>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            quick.mutate("tomorrow");
          }}
        >
          Tomorrow morning
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            quick.mutate("week");
          }}
        >
          Next week
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            quick.mutate("reply");
          }}
        >
          If no reply in a week
        </DropdownMenuItem>
        {sidebar ? (
          <DropdownMenuItem
            onSelect={() => {
              void sidebar.onCreateReminder({
                mailboxId,
                target: {
                  anchorMessageId: message.id,
                  condition: null,
                  kind: "thread",
                  threadId: message.threadId,
                },
                title: message.subject || "Follow up",
              });
            }}
          >
            Choose date or condition...
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const MessageReminderSuggestion = ({
  mailboxId,
  message,
}: MessageReminderProps) => {
  const queryClient = useQueryClient();
  const preferences = useQuery(reminderPreferencesOptions(mailboxId));
  const reminders = useReminderList(mailboxId, "active");
  const hasReminder =
    reminders.data?.items.some(
      (item) =>
        item.status === "active" &&
        item.target.kind === "thread" &&
        item.target.threadId === message.threadId
    ) === true;
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions();
  const queryKey = [
    "reminder-suggestion",
    mailboxId,
    message.threadId,
    message.id,
    timeZone,
  ];
  const query = useQuery({
    enabled:
      preferences.data?.suggestions === true &&
      !hasReminder &&
      !reminders.isPending &&
      !reminders.isError,
    queryFn: async ({ signal }) =>
      await rpc.reminders.suggestion(
        {
          mailboxId,
          messageId: message.id,
          threadId: message.threadId,
          timeZone,
        },
        { signal }
      ),
    queryKey,
    refetchInterval: (current) =>
      current.state.data?.status === "pending" &&
      current.state.dataUpdateCount < 6
        ? 5000
        : false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15 * 60_000,
  });
  const action = useMutation({
    mutationFn: async ({
      suggestionId,
      kind,
    }: {
      suggestionId: string;
      kind: "accept" | "dismiss";
    }) => {
      if (kind === "accept") {
        return await rpc.reminders.acceptSuggestion({
          mailboxId,
          suggestionId,
        });
      }
      await rpc.reminders.dismissSuggestion({ mailboxId, suggestionId });
      return null;
    },
    onError: (error) => {
      toastError(error, {
        boundary: "reminder-suggestion",
        fallback: "Could not update this suggestion. Please try again.",
      });
    },
    onSuccess: async (reminder, input) => {
      queryClient.setQueryData(queryKey, { status: "none", suggestion: null });
      if (input.kind === "accept") {
        if (reminder) {
          cacheReminder({ client: queryClient, demo: false, reminder });
        }
        await queryClient.invalidateQueries({
          queryKey: ["reminders", mailboxId],
        });
      }
    },
  });
  const suggestion = query.data?.suggestion;
  const now = useReminderClock(suggestion ? [suggestion] : undefined);
  if (
    hasReminder ||
    reminders.isPending ||
    reminders.isError ||
    preferences.data?.suggestions !== true ||
    query.isError ||
    suggestion?.status !== "suggested" ||
    suggestion.confidence !== "clear" ||
    Date.parse(suggestion.dueAt) <= now
  ) {
    return null;
  }
  return (
    <Surface className="mt-3" padding="dense" variant="section">
      <div className="flex items-center gap-1">
        <Button
          className="min-w-0 flex-1"
          disabled={action.isPending}
          onClick={() => {
            action.mutate({ kind: "accept", suggestionId: suggestion.id });
          }}
          size="compact"
          variant="ghost"
        >
          <Icon icon={Clock01Icon} tone="muted" />
          <span className="truncate">
            Remind me{" "}
            {new Intl.DateTimeFormat(undefined, {
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              timeZone: suggestion.timeZone,
              timeZoneName: "short",
              weekday: "short",
            }).format(new Date(suggestion.dueAt))}
          </span>
        </Button>
        <Popover>
          <IconButtonTooltip label="Why this reminder?">
            <PopoverTrigger
              render={
                <Button
                  aria-label="Why this reminder?"
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <Icon icon={InformationCircleIcon} />
            </PopoverTrigger>
          </IconButtonTooltip>
          <PopoverContent align="end">
            <p className="text-body-sm">{suggestion.reason}</p>
            <p className="mt-2 text-caption text-muted-fg">
              {suggestion.title}
            </p>
          </PopoverContent>
        </Popover>
        <IconButtonTooltip label="Dismiss suggestion">
          <Button
            aria-label="Dismiss suggestion"
            disabled={action.isPending}
            onClick={() => {
              action.mutate({ kind: "dismiss", suggestionId: suggestion.id });
            }}
            size="icon-xs"
            variant="ghost"
          >
            <Icon icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
    </Surface>
  );
};
