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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { Surface } from "@quieter/ui/surface";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use } from "react";

import { useQuickReminder } from "./quick-reminder";
import type { QuickReminderPreset } from "./quick-reminder";
import { ReminderSnoozeMenu } from "./reminder-actions";
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
  const sidebar = use(AssistantSidebarContext);
  const mutation = useReminderMutation({ demo, reminder });
  const date = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    timeZone: reminder.timeZone,
  }).format(new Date(reminder.dueAt));
  return (
    <DropdownMenu>
      <IconButtonTooltip label={`Reminder set for ${date}`}>
        <DropdownMenuTrigger
          appearance="row"
          aria-label={`Reminder set for ${date}`}
          disabled={mutation.isPending}
        >
          <Icon icon={Clock01Icon} size={14} />
          <span>{date}</span>
        </DropdownMenuTrigger>
      </IconButtonTooltip>
      <DropdownMenuContent align="start">
        <ReminderSnoozeMenu
          demo={demo}
          onCustom={() => {
            void sidebar?.onOpenReminders(undefined, reminder.mailboxId, {
              kind: "edit",
              reminder,
            });
          }}
          reminder={reminder}
        />
        <DropdownMenuItem
          disabled={!sidebar}
          onSelect={() => {
            void sidebar?.onOpenReminders(undefined, reminder.mailboxId, {
              kind: "edit",
              reminder,
            });
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
  );
};

const useThreadReminder = (mailboxId: string, threadId: string | null) => {
  const demo =
    isGmailSandboxMailboxId(mailboxId) || isManagedSandboxMailboxId(mailboxId);
  const reminders = useReminderList(
    threadId === null ? "" : mailboxId,
    "active",
    demo
  );
  return {
    demo,
    existing: reminders.data?.items.find(
      (item) =>
        item.status === "active" &&
        item.target.kind === "thread" &&
        item.target.threadId === threadId
    ),
    isPending: reminders.isPending,
  };
};

export const MessageReminderStatus = ({
  mailboxId,
  message,
}: MessageReminderProps) => {
  const { demo, existing } = useThreadReminder(mailboxId, message.threadId);
  return existing ? (
    <ExistingMessageReminder demo={demo} reminder={existing} />
  ) : null;
};

// The submenu unmounts with its menu, so its owner keeps the retry attempts.
export const useMessageReminderMenu = (
  mailboxId: string,
  message: MessageReminderProps["message"] | null
) => {
  const { existing, isPending } = useThreadReminder(
    mailboxId,
    message?.threadId ?? null
  );
  const quick = useQuickReminder({ mailboxId, message });
  if (message === null || existing) {
    return null;
  }
  return {
    disabled: quick.isPending || isPending,
    mailboxId,
    message,
    onPreset: (preset: QuickReminderPreset) => {
      quick.mutate(preset);
    },
  };
};

export const MessageReminderSubmenu = ({
  disabled,
  mailboxId,
  message,
  onPreset,
}: NonNullable<ReturnType<typeof useMessageReminderMenu>>) => {
  const sidebar = use(AssistantSidebarContext);
  return (
    <DropdownMenuSubmenu>
      <DropdownMenuSubmenuTrigger disabled={disabled}>
        <span className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden icon={Clock01Icon} />
          <span className="truncate">Remind me</span>
        </span>
      </DropdownMenuSubmenuTrigger>
      <DropdownMenuSubmenuContent>
        <DropdownMenuItem
          onSelect={() => {
            onPreset("tomorrow");
          }}
        >
          Tomorrow morning
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onPreset("week");
          }}
        >
          Next week
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onPreset("reply");
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
      </DropdownMenuSubmenuContent>
    </DropdownMenuSubmenu>
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
