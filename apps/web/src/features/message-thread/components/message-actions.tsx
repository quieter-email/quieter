"use client";

import type { CSSProperties, PropsWithChildren } from "react";
import {
  Archive02Icon,
  ArrowUpRight01Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen02Icon,
  MoreVerticalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { cn } from "@quieter/ui/cn";
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
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useState } from "react";
import { MessageLabelsDialog } from "~/features/message-labels/components/message-labels-dialog";
import { isMessageUnread, type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import type { LabelChanges, ThreadActionHandlers } from "./message-action-handlers";
import { getMessageUnsubscribeTarget, openUnsubscribeUrl } from "./message-unsubscribe";

type MessageActionsSharedProps = {
  actions: ThreadActionHandlers;
  mailboxId: string;
  message: MessageListItem;
  mailbox: MailboxCategory;
  isUnread?: boolean;
  isPending?: boolean;
  labelNounPlural?: "labels";
};

type MessageActionsDropdownProps = MessageActionsSharedProps;

type MessageActionsContextMenuProps = PropsWithChildren<
  MessageActionsSharedProps & {
    triggerClassName?: string;
    triggerStyle?: CSSProperties;
  }
>;

type MenuAction = {
  type: "item";
  id: string;
  label: string;
  icon: IconSvgElement;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

type MenuSeparator = {
  type: "separator";
  id: string;
};

type MenuEntry = MenuAction | MenuSeparator;

const renderDropdownEntry = (entry: MenuEntry) => {
  if (entry.type === "separator") {
    return <DropdownMenuSeparator key={entry.id} />;
  }

  return (
    <DropdownMenuItem
      className={cn({ "text-destructive": entry.destructive })}
      disabled={entry.disabled}
      key={entry.id}
      onSelect={entry.onSelect}
    >
      <HugeiconsIcon aria-hidden className="size-4" icon={entry.icon} />
      <span>{entry.label}</span>
    </DropdownMenuItem>
  );
};

const renderContextEntry = (entry: MenuEntry) => {
  if (entry.type === "separator") {
    return <ContextMenuSeparator key={entry.id} />;
  }

  return (
    <ContextMenuItem
      className={cn({ "text-destructive": entry.destructive })}
      disabled={entry.disabled}
      key={entry.id}
      onSelect={entry.onSelect}
    >
      <HugeiconsIcon aria-hidden className="size-4" icon={entry.icon} />
      <span>{entry.label}</span>
    </ContextMenuItem>
  );
};

const MessageActionsDialogs = ({
  isPending,
  mailboxId,
  message,
  onOpenLabelsDialog,
  onUpdateLabels,
  openLabelsDialog,
}: {
  mailboxId: string;
  message: MessageListItem;
  isPending: boolean;
  openLabelsDialog: boolean;
  onOpenLabelsDialog: (open: boolean) => void;
  onUpdateLabels?: (threadId: string, changes: LabelChanges) => void | Promise<void>;
}) => {
  return (
    <MessageLabelsDialog
      isPending={isPending}
      mailboxId={mailboxId}
      onApply={async ([update]) => {
        if (!update || !onUpdateLabels) return;
        await onUpdateLabels(update.id, update);
      }}
      onOpenChange={onOpenLabelsDialog}
      open={openLabelsDialog}
      targets={[{ id: message.threadId, labelIds: message.labelIds ?? [] }]}
    />
  );
};

const useMessageActionEntries = (props: MessageActionsSharedProps) => {
  const actions = props.actions;
  const isUnread = props.isUnread ?? isMessageUnread(props.message);
  const isDraftMailbox = props.mailbox === "drafts";
  const isArchiveMailbox = props.mailbox === "archive";
  const isSpamMailbox = props.mailbox === "spam";
  const isTrashMailbox = props.mailbox === "trash";
  const isBusy = !!props.isPending;
  const [openLabelsDialog, setOpenLabelsDialog] = useState(false);
  const showArchive = props.mailbox === "inbox" || props.mailbox === "unread";
  const showMarkAsSpam = props.mailbox === "inbox";
  const unsubscribeTarget = getMessageUnsubscribeTarget(props.message);
  const hasFolderAction =
    (showArchive && !!actions.onArchive) ||
    (showMarkAsSpam && !!actions.onMarkAsSpam) ||
    (isSpamMailbox && !!actions.onUnmarkAsSpam) ||
    ((isTrashMailbox || isArchiveMailbox) && !!actions.onUntrash) ||
    (!isTrashMailbox && !!actions.onMoveToTrash);
  const hasReadStateAction = !!actions.onMarkAsRead || !!actions.onMarkAsUnread;

  if (isDraftMailbox) {
    return {
      dialogs: null,
      entries: [
        {
          type: "item",
          id: "open-draft",
          disabled: isBusy || !actions.onOpenDraft,
          icon: Edit01Icon,
          label: "Open draft",
          onSelect: () => {
            void actions.onOpenDraft?.(props.message);
          },
        },
        {
          type: "separator",
          id: "separator",
        },
        {
          type: "item",
          id: "delete-draft",
          destructive: true,
          disabled: isBusy || !actions.onDeleteDraft,
          icon: Delete02Icon,
          label: "Delete draft",
          onSelect: () => {
            void actions.onDeleteDraft?.(props.message);
          },
        },
      ] satisfies MenuEntry[],
      isBusy,
    };
  }

  if (
    !hasReadStateAction &&
    !actions.onUpdateLabels &&
    !actions.onUnsubscribe &&
    !hasFolderAction
  ) {
    return { dialogs: null, entries: [], isBusy };
  }

  const entries: MenuEntry[] = [
    ...(hasReadStateAction
      ? [
          {
            type: "item" as const,
            id: "toggle-read-state",
            disabled: isBusy || (isUnread ? !actions.onMarkAsRead : !actions.onMarkAsUnread),
            icon: isUnread ? MailOpen02Icon : Mail01Icon,
            label: isUnread ? "Mark as Read" : "Mark as Unread",
            onSelect: () => {
              if (isUnread) {
                void actions.onMarkAsRead?.(props.message.threadId);
                return;
              }

              void actions.onMarkAsUnread?.(props.message.threadId);
            },
          },
        ]
      : []),
    ...(actions.onUpdateLabels
      ? [
          {
            type: "item" as const,
            id: "modify-labels",
            disabled: isBusy,
            icon: Tag01Icon,
            label: `Modify ${props.labelNounPlural ?? "labels"}`,
            onSelect: () => setOpenLabelsDialog(true),
          },
        ]
      : []),
    ...(unsubscribeTarget
      ? [
          {
            type: "item" as const,
            id: "unsubscribe",
            disabled:
              unsubscribeTarget.kind === "mailto" ? isBusy || !actions.onUnsubscribe : false,
            icon: unsubscribeTarget.kind === "mailto" ? Mail01Icon : ArrowUpRight01Icon,
            label: "Unsubscribe",
            onSelect: () => {
              if (unsubscribeTarget.kind === "mailto") {
                void actions.onUnsubscribe?.(props.message.id);
                return;
              }

              openUnsubscribeUrl(unsubscribeTarget.url);
            },
          },
        ]
      : []),
    ...(hasFolderAction ? [{ type: "separator" as const, id: "separator" }] : []),
    ...(showArchive && actions.onArchive
      ? [
          {
            type: "item" as const,
            id: "archive",
            disabled: isBusy,
            icon: Archive02Icon,
            label: "Archive",
            onSelect: () => {
              void actions.onArchive?.(props.message.threadId);
            },
          },
        ]
      : []),
    ...(showMarkAsSpam && actions.onMarkAsSpam
      ? [
          {
            type: "item" as const,
            id: "mark-as-spam",
            destructive: true,
            disabled: isBusy,
            icon: Delete02Icon,
            label: "Mark as Spam",
            onSelect: () => {
              void actions.onMarkAsSpam?.(props.message.threadId);
            },
          },
        ]
      : []),
    ...(isSpamMailbox && actions.onUnmarkAsSpam
      ? [
          {
            type: "item" as const,
            id: "unmark-as-spam",
            disabled: isBusy,
            icon: Mail01Icon,
            label: "Unmark as Spam",
            onSelect: () => {
              void actions.onUnmarkAsSpam?.(props.message.threadId);
            },
          },
        ]
      : []),
    ...((isTrashMailbox || isArchiveMailbox) && actions.onUntrash
      ? [
          {
            type: "item" as const,
            id: "remove-from-trash",
            disabled: isBusy,
            icon: InboxIcon,
            label: "Move to Inbox",
            onSelect: () => {
              void actions.onUntrash?.(props.message.threadId);
            },
          },
        ]
      : []),
    ...(!isTrashMailbox && actions.onMoveToTrash
      ? [
          {
            type: "item" as const,
            id: "move-to-trash",
            destructive: true,
            disabled: isBusy,
            icon: Delete01Icon,
            label: "Move to Trash",
            onSelect: () => {
              void actions.onMoveToTrash?.(props.message.threadId);
            },
          },
        ]
      : []),
  ];

  const dialogs = actions.onUpdateLabels ? (
    <MessageActionsDialogs
      isPending={isBusy}
      mailboxId={props.mailboxId}
      message={props.message}
      onOpenLabelsDialog={setOpenLabelsDialog}
      onUpdateLabels={actions.onUpdateLabels}
      openLabelsDialog={openLabelsDialog}
    />
  ) : null;

  return {
    dialogs,
    entries,
    isBusy,
  };
};

export const MessageActionsDropdown = (props: MessageActionsDropdownProps) => {
  const { dialogs, entries, isBusy } = useMessageActionEntries(props);
  if (entries.length === 0) return dialogs;

  return (
    <>
      <DropdownMenu>
        <IconButtonTooltip label="Message actions">
          <DropdownMenuTrigger
            aria-label="Open message actions"
            className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background shadow-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
            disabled={isBusy}
            type="button"
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={MoreVerticalIcon} />
          </DropdownMenuTrigger>
        </IconButtonTooltip>

        <DropdownMenuContent>
          {entries.map((entry) => renderDropdownEntry(entry))}
        </DropdownMenuContent>
      </DropdownMenu>

      {dialogs}
    </>
  );
};

export const MessageActionsContextMenu = ({
  children,
  triggerClassName,
  triggerStyle,
  ...props
}: MessageActionsContextMenuProps) => {
  const { dialogs, entries } = useMessageActionEntries(props);
  if (entries.length === 0) return <>{children}</>;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className={triggerClassName} style={triggerStyle}>
          {children}
        </ContextMenuTrigger>

        <ContextMenuContent>{entries.map((entry) => renderContextEntry(entry))}</ContextMenuContent>
      </ContextMenu>

      {dialogs}
    </>
  );
};
