"use client";

import {
  AlarmClockIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen02Icon,
  MoreVerticalIcon,
  StarIcon,
  NotificationOff01Icon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { MessageLabelsSubmenu } from "@quieter/app/features/message-labels/components/message-labels-menu";
import type {
  MessageLabelsTarget,
  MessageLabelsUpdate,
} from "@quieter/app/features/message-labels/domain/message-label-updates";
import type { MessageListProps } from "@quieter/app/features/message-list/components/message-list-types";
import type { ThreadActionHandlers } from "@quieter/app/features/message-thread/components/message-action-handlers";
import {
  getMessageUnsubscribeTarget,
  messageUnsubscribeLabels,
  openUnsubscribeUrl,
} from "@quieter/app/features/message-thread/components/message-unsubscribe";
import {
  MessageReminderSubmenu,
  useMessageReminderMenu,
} from "@quieter/app/features/reminders/message-reminders";
import { toastError } from "@quieter/app/lib/error-toast";
import { isMessageUnread } from "@quieter/app/lib/mail";
import type { MailboxCategory, MessageListItem } from "@quieter/app/lib/mail";
import { isMailSnoozeLiveStatus } from "@quieter/mail/snooze";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@quieter/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import type { CSSProperties, PropsWithChildren } from "react";

import type { MailSnoozeAction } from "../../mailbox/domain/mail-snooze";

type MessageActionsSharedProps = {
  actions: ThreadActionHandlers;
  inlineImportance?: boolean;
  inlineLabels?: boolean;
  mailboxId: string;
  mailboxContextsByThreadId?: MessageListProps["mailboxContextsByThreadId"];
  message: MessageListItem;
  mailbox: MailboxCategory;
  reminderMenu?: ReturnType<typeof useMessageReminderMenu>;
  snoozeEntry?: { action: MailSnoozeAction; onOpen: () => void };
  threadLabelIds: readonly string[];
  isUnread?: boolean;
};

type MessageActionsDropdownProps = Omit<
  MessageActionsSharedProps,
  "reminderMenu"
> & {
  isMessageActionPending: boolean;
  isThreadActionPending: boolean;
  reminderMessage: Parameters<typeof useMessageReminderMenu>[1];
};

type MessageActionsContextMenuProps = PropsWithChildren<
  MessageActionsSharedProps & {
    isMessageActionPending?: boolean;
    isPending?: boolean;
    isThreadActionPending?: boolean;
    triggerClassName?: string;
    triggerStyle?: CSSProperties;
  }
>;

type MenuPendingActions = {
  message: boolean;
  thread: boolean;
  optimistic: boolean;
};

type MenuAction = {
  type: "item";
  id: string;
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  destructive?: boolean;
  onAction: () => void;
};

type MenuSeparator = {
  type: "separator";
  id: string;
};

type MenuLabels = {
  type: "labels";
  id: string;
  label: string;
  disabled: boolean;
  isPending: boolean;
  mailboxId: string;
  onApply: (updates: MessageLabelsUpdate[]) => Promise<void>;
  targets: readonly MessageLabelsTarget[];
};

type MenuReminder = {
  type: "reminder";
  id: string;
  menu: NonNullable<MessageActionsSharedProps["reminderMenu"]>;
};

type MenuEntry = MenuAction | MenuLabels | MenuReminder | MenuSeparator;

const renderLabelsEntry = (entry: MenuLabels) => (
  <MessageLabelsSubmenu
    disabled={entry.disabled}
    isPending={entry.isPending}
    key={entry.id}
    label={entry.label}
    mailboxId={entry.mailboxId}
    onApply={entry.onApply}
    targets={entry.targets}
  />
);

const renderDropdownEntry = (entry: MenuEntry) => {
  if (entry.type === "separator") {
    return <DropdownMenuSeparator key={entry.id} />;
  }

  if (entry.type === "labels") {
    return renderLabelsEntry(entry);
  }

  if (entry.type === "reminder") {
    return <MessageReminderSubmenu key={entry.id} {...entry.menu} />;
  }

  return (
    <DropdownMenuItem
      disabled={entry.disabled}
      key={entry.id}
      onSelect={entry.onAction}
      tone={entry.destructive === true ? "destructive" : undefined}
    >
      <Icon aria-hidden icon={entry.icon} />
      <span>{entry.label}</span>
    </DropdownMenuItem>
  );
};

const renderContextEntry = (entry: MenuEntry) => {
  if (entry.type === "separator") {
    return <ContextMenuSeparator key={entry.id} />;
  }

  if (entry.type === "labels") {
    return renderLabelsEntry(entry);
  }

  if (entry.type === "reminder") {
    return <MessageReminderSubmenu key={entry.id} {...entry.menu} />;
  }

  return (
    <ContextMenuItem
      disabled={entry.disabled}
      key={entry.id}
      onSelect={entry.onAction}
      tone={entry.destructive === true ? "destructive" : undefined}
    >
      <Icon aria-hidden icon={entry.icon} />
      <span>{entry.label}</span>
    </ContextMenuItem>
  );
};

const createDraftEntries = (
  props: MessageActionsSharedProps,
  isBusy: boolean
): MenuEntry[] => [
  {
    disabled: isBusy || !props.actions.onOpenDraft,
    icon: Edit01Icon,
    id: "open-draft",
    label: "Open draft",
    onAction: () => {
      void props.actions.onOpenDraft?.(props.message);
    },
    type: "item",
  },
  {
    id: "separator",
    type: "separator",
  },
  {
    destructive: true,
    disabled: isBusy || !props.actions.onDeleteDraft,
    icon: Delete02Icon,
    id: "delete-draft",
    label: "Delete draft",
    onAction: () => {
      void props.actions.onDeleteDraft?.(props.message);
    },
    type: "item",
  },
];

const createReadStateEntry = (
  props: MessageActionsSharedProps,
  isBusy: boolean,
  isUnread: boolean
): MenuAction | null => {
  if (!props.actions.onMarkAsRead && !props.actions.onMarkAsUnread) {
    return null;
  }

  return {
    disabled:
      isBusy ||
      (isUnread ? !props.actions.onMarkAsRead : !props.actions.onMarkAsUnread),
    icon: isUnread ? MailOpen02Icon : Mail01Icon,
    id: "toggle-read-state",
    label: isUnread ? "Mark as Read" : "Mark as Unread",
    onAction: () => {
      void (async () => {
        try {
          if (isUnread) {
            await props.actions.onMarkAsRead?.(props.message.threadId);
          } else {
            await props.actions.onMarkAsUnread?.(props.message.threadId);
          }
        } catch (error) {
          toastError(error, { boundary: "message-read-state" });
        }
      })();
    },
    type: "item",
  };
};

const createLabelsEntry = (
  props: MessageActionsSharedProps,
  isBusy: boolean
): MenuLabels | null => {
  const { onUpdateLabels } = props.actions;
  if (!onUpdateLabels) {
    return null;
  }

  return {
    disabled: isBusy,
    id: "modify-labels",
    isPending: isBusy,
    label: "Labels",
    mailboxId: props.mailboxId,
    onApply: async ([update]) => {
      if (update === undefined) {
        return;
      }
      await onUpdateLabels(update.id, update);
    },
    targets: [{ id: props.message.threadId, labelIds: props.threadLabelIds }],
    type: "labels",
  };
};

const createUnsubscribeEntry = (
  props: MessageActionsSharedProps,
  isBusy: boolean,
  unsubscribeTarget: NonNullable<ReturnType<typeof getMessageUnsubscribeTarget>>
): MenuAction => ({
  disabled:
    unsubscribeTarget.kind !== "url" &&
    (isBusy || !props.actions.onUnsubscribe),
  icon: NotificationOff01Icon,
  id: "unsubscribe",
  label: messageUnsubscribeLabels[unsubscribeTarget.kind],
  onAction: () => {
    void (async () => {
      try {
        if (unsubscribeTarget.kind === "url") {
          openUnsubscribeUrl(unsubscribeTarget.url);
          return;
        }
        await props.actions.onUnsubscribe?.(props.message.id);
      } catch (error) {
        toastError(error, { boundary: "unsubscribe" });
      }
    })();
  },
  type: "item",
});

const createFolderEntries = (
  props: MessageActionsSharedProps,
  pending: MenuPendingActions,
  sharedPlacement: boolean
): MenuEntry[] => {
  const entries: MenuEntry[] = [];
  const hasInbox = props.threadLabelIds.includes("INBOX");
  const hasSnooze =
    props.message.snooze !== undefined &&
    isMailSnoozeLiveStatus(props.message.snooze.status);
  const canChangePlacement = !["drafts", "spam", "trash", "sent"].includes(
    props.mailbox
  );
  if (canChangePlacement && hasInbox && props.actions.onMarkDone) {
    entries.push({
      disabled: pending.thread,
      icon: CheckmarkCircle02Icon,
      id: "mark-done",
      label: sharedPlacement ? "Done for everyone" : "Done",
      onAction: () => {
        void props.actions.onMarkDone?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if (canChangePlacement && !hasInbox && props.actions.onReturnToInbox) {
    entries.push({
      disabled: pending.thread,
      icon: InboxIcon,
      id: "return-to-inbox",
      label: sharedPlacement
        ? "Return to Inbox for everyone"
        : "Return to Inbox",
      onAction: () => {
        if (hasSnooze) {
          void props.actions.onApplySnooze?.(props.message.threadId, {
            kind: "return-now",
          });
          return;
        }
        void props.actions.onReturnToInbox?.(props.message.threadId);
      },
      type: "item",
    });
  }
  const { snoozeEntry } = props;
  if (canChangePlacement && snoozeEntry && props.actions.onApplySnooze) {
    entries.push({
      disabled: pending.thread,
      icon: AlarmClockIcon,
      id: "snooze",
      label: `${snoozeEntry.action === "reschedule" ? "Change return time" : "Snooze"}${sharedPlacement ? " for everyone" : ""}`,
      onAction: snoozeEntry.onOpen,
      type: "item",
    });
  }
  if (
    canChangePlacement &&
    hasSnooze &&
    props.message.snooze?.status !== "returning" &&
    props.actions.onApplySnooze
  ) {
    const keepInDone =
      props.message.snooze?.status === "active" &&
      !hasInbox &&
      (props.message.threadInboxIncomingMessageIds?.length ?? 0) === 0;
    entries.push({
      disabled: pending.thread,
      icon: CancelCircleIcon,
      id: "cancel-snooze",
      label: `${keepInDone ? "Keep in Done" : "Cancel return"}${sharedPlacement ? " for everyone" : ""}`,
      onAction: () => {
        void props.actions.onApplySnooze?.(props.message.threadId, {
          kind: "cancel",
        });
      },
      type: "item",
    });
  }
  const showMarkAsSpam =
    props.mailbox === "inbox" || props.mailbox === "important";
  const isSpamMailbox = props.mailbox === "spam";
  const isTrashMailbox = props.mailbox === "trash";

  if (showMarkAsSpam && props.actions.onMarkAsSpam) {
    entries.push({
      destructive: true,
      disabled: pending.optimistic,
      icon: Delete02Icon,
      id: "mark-as-spam",
      label: "Mark as Spam",
      onAction: () => {
        void props.actions.onMarkAsSpam?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if (isSpamMailbox && props.actions.onUnmarkAsSpam) {
    entries.push({
      disabled: pending.optimistic,
      icon: Mail01Icon,
      id: "unmark-as-spam",
      label: "Unmark as Spam",
      onAction: () => {
        void props.actions.onUnmarkAsSpam?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if (isTrashMailbox && props.actions.onUntrash) {
    entries.push({
      disabled: pending.optimistic,
      icon: InboxIcon,
      id: "remove-from-trash",
      label: "Move to Inbox",
      onAction: () => {
        void props.actions.onUntrash?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if (!isTrashMailbox && props.actions.onMoveToTrash) {
    entries.push({
      destructive: true,
      disabled: pending.optimistic,
      icon: Delete01Icon,
      id: "move-to-trash",
      label: "Move to Trash",
      onAction: () => {
        void props.actions.onMoveToTrash?.(props.message.threadId);
      },
      type: "item",
    });
  }

  return entries;
};

const createMessageActionEntries = ({
  isUnread,
  pending,
  props,
  unsubscribeTarget,
  sharedPlacement,
}: {
  sharedPlacement: boolean;
  isUnread: boolean;
  pending: MenuPendingActions;
  props: MessageActionsSharedProps;
  unsubscribeTarget: ReturnType<typeof getMessageUnsubscribeTarget>;
}) => {
  const entries: MenuEntry[] = [];
  const readStateEntry = createReadStateEntry(
    props,
    pending.optimistic,
    isUnread
  );
  const labelsEntry =
    props.inlineLabels === true
      ? null
      : createLabelsEntry(props, pending.optimistic);
  const folderEntries = createFolderEntries(props, pending, sharedPlacement);

  if (readStateEntry !== null) {
    entries.push(readStateEntry);
  }
  if (props.actions.onSetImportance && props.inlineImportance !== true) {
    const important =
      props.message.threadIsImportant ?? props.message.isImportant ?? false;
    entries.push({
      disabled: pending.thread,
      icon: StarIcon,
      id: "toggle-importance",
      label: important ? "Mark as not important" : "Mark as important",
      onAction: () => {
        void props.actions.onSetImportance?.(
          props.message.threadId,
          !important
        );
      },
      type: "item",
    });
  }
  if (labelsEntry !== null) {
    entries.push(labelsEntry);
  }
  if (props.reminderMenu) {
    entries.push({
      id: "reminder",
      menu: props.reminderMenu,
      type: "reminder",
    });
  }
  if (unsubscribeTarget !== null) {
    entries.push(
      createUnsubscribeEntry(props, pending.message, unsubscribeTarget)
    );
  }
  if (folderEntries.length > 0) {
    entries.push({ id: "separator", type: "separator" }, ...folderEntries);
  }

  return entries;
};

const getMessageActionEntries = (
  props: MessageActionsSharedProps,
  pending: MenuPendingActions
): MenuEntry[] => {
  const placementScope =
    props.mailboxContextsByThreadId?.get(props.message.threadId)?.mailboxActions
      .placementScope ?? props.actions.placementScope;
  const sharedPlacement = placementScope === "shared";
  const isUnread = props.isUnread ?? isMessageUnread(props.message);

  if (props.mailbox === "drafts") {
    return createDraftEntries(props, pending.message);
  }

  return createMessageActionEntries({
    isUnread,
    pending,
    props,
    sharedPlacement,
    unsubscribeTarget: getMessageUnsubscribeTarget(props.message),
  });
};

export const MessageActionsDropdown = ({
  isMessageActionPending,
  isThreadActionPending,
  reminderMessage,
  ...props
}: MessageActionsDropdownProps) => {
  const reminderMenu = useMessageReminderMenu(props.mailboxId, reminderMessage);
  const entries = getMessageActionEntries(
    { ...props, reminderMenu },
    {
      message: isMessageActionPending,
      optimistic: false,
      thread: isThreadActionPending,
    }
  );
  if (entries.length === 0) {
    return null;
  }

  return (
    <DropdownMenu>
      <IconButtonTooltip label="Message actions">
        <DropdownMenuTrigger
          chrome="toolbar"
          appearance="icon"
          aria-label="Open message actions"
          type="button"
        >
          <Icon aria-hidden size={14} icon={MoreVerticalIcon} />
        </DropdownMenuTrigger>
      </IconButtonTooltip>

      <DropdownMenuContent align="end">
        {entries.map((entry) => renderDropdownEntry(entry))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const MessageActionsContextMenu = ({
  children,
  isMessageActionPending,
  isPending = false,
  isThreadActionPending,
  triggerClassName,
  triggerStyle,
  ...props
}: MessageActionsContextMenuProps) => {
  const entries = getMessageActionEntries(props, {
    message: isMessageActionPending ?? isPending,
    optimistic: false,
    thread: isThreadActionPending ?? isPending,
  });
  if (entries.length === 0) {
    return children;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger
        // oxlint-disable-next-line shadcn/require-static-classes -- Trigger classes come from the caller.
        className={triggerClassName}
        // oxlint-disable-next-line shadcn/no-inline-styles -- Trigger style comes from the caller.
        style={triggerStyle}
      >
        {children}
      </ContextMenuTrigger>

      <ContextMenuContent>
        {entries.map((entry) => renderContextEntry(entry))}
      </ContextMenuContent>
    </ContextMenu>
  );
};
