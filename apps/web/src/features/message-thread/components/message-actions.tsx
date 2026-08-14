"use client";

import {
  Archive02Icon,
  ArrowUpRight01Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Mail01Icon,
  MailOpen02Icon,
  Loading03Icon,
  MoreVerticalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
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
import type { CSSProperties, PropsWithChildren } from "react";
import { useState } from "react";

import { MessageLabelsDialog } from "#/features/message-labels/components/message-labels-dialog";
import { isMessageUnread } from "#/lib/gmail/gmail";
import type { MailboxCategory, MessageListItem } from "#/lib/gmail/gmail";

import type {
  LabelChanges,
  ThreadActionHandlers,
} from "./message-action-handlers";
import {
  getMessageUnsubscribeTarget,
  openUnsubscribeUrl,
} from "./message-unsubscribe";

type MessageActionsSharedProps = {
  actions: ThreadActionHandlers;
  mailboxId: string;
  message: MessageListItem;
  mailbox: MailboxCategory;
  threadLabelIds: readonly string[];
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
  onAction: () => void;
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
      onSelect={entry.onAction}
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
      onSelect={entry.onAction}
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
  onLabelsUpdate,
  openLabelsDialog,
  threadLabelIds,
}: {
  mailboxId: string;
  message: MessageListItem;
  threadLabelIds: readonly string[];
  isPending: boolean;
  openLabelsDialog: boolean;
  onOpenLabelsDialog: (open: boolean) => void;
  onLabelsUpdate?: (
    threadId: string,
    changes: LabelChanges
  ) => void | Promise<void>;
}) => (
  <MessageLabelsDialog
    isPending={isPending}
    mailboxId={mailboxId}
    onApply={async ([update]) => {
      if (update === undefined || onLabelsUpdate === undefined) {
        return;
      }
      await onLabelsUpdate(update.id, update);
    }}
    onOpenChange={onOpenLabelsDialog}
    open={openLabelsDialog}
    targets={[{ id: message.threadId, labelIds: threadLabelIds }]}
  />
);

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
      if (isUnread) {
        void props.actions.onMarkAsRead?.(props.message.threadId);
        return;
      }

      void props.actions.onMarkAsUnread?.(props.message.threadId);
    },
    type: "item",
  };
};

const createLabelsEntry = (
  props: MessageActionsSharedProps,
  isBusy: boolean,
  onOpenLabels: () => void
): MenuAction | null => {
  if (!props.actions.onUpdateLabels) {
    return null;
  }

  return {
    disabled: isBusy,
    icon: Tag01Icon,
    id: "modify-labels",
    label: `Modify ${props.labelNounPlural ?? "labels"}`,
    onAction: onOpenLabels,
    type: "item",
  };
};

const createUnsubscribeEntry = (
  props: MessageActionsSharedProps,
  isBusy: boolean,
  unsubscribeTarget: NonNullable<ReturnType<typeof getMessageUnsubscribeTarget>>
): MenuAction => ({
  disabled:
    unsubscribeTarget.kind === "mailto"
      ? isBusy || !props.actions.onUnsubscribe
      : false,
  icon: unsubscribeTarget.kind === "mailto" ? Mail01Icon : ArrowUpRight01Icon,
  id: "unsubscribe",
  label: "Unsubscribe",
  onAction: () => {
    if (unsubscribeTarget.kind === "mailto") {
      void props.actions.onUnsubscribe?.(props.message.id);
      return;
    }

    openUnsubscribeUrl(unsubscribeTarget.url);
  },
  type: "item",
});

const createFolderEntries = (
  props: MessageActionsSharedProps,
  isBusy: boolean
): MenuEntry[] => {
  const entries: MenuEntry[] = [];
  const showArchive = props.mailbox === "inbox" || props.mailbox === "unread";
  const showMarkAsSpam = props.mailbox === "inbox";
  const isArchiveMailbox = props.mailbox === "archive";
  const isSpamMailbox = props.mailbox === "spam";
  const isTrashMailbox = props.mailbox === "trash";

  if (showArchive && props.actions.onArchive) {
    entries.push({
      disabled: isBusy,
      icon: Archive02Icon,
      id: "archive",
      label: "Archive",
      onAction: () => {
        void props.actions.onArchive?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if (showMarkAsSpam && props.actions.onMarkAsSpam) {
    entries.push({
      destructive: true,
      disabled: isBusy,
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
      disabled: isBusy,
      icon: Mail01Icon,
      id: "unmark-as-spam",
      label: "Unmark as Spam",
      onAction: () => {
        void props.actions.onUnmarkAsSpam?.(props.message.threadId);
      },
      type: "item",
    });
  }
  if ((isTrashMailbox || isArchiveMailbox) && props.actions.onUntrash) {
    entries.push({
      disabled: isBusy,
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
      disabled: isBusy,
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
  isBusy,
  isUnread,
  onOpenLabels,
  props,
  unsubscribeTarget,
}: {
  isBusy: boolean;
  isUnread: boolean;
  onOpenLabels: () => void;
  props: MessageActionsSharedProps;
  unsubscribeTarget: ReturnType<typeof getMessageUnsubscribeTarget>;
}) => {
  const entries: MenuEntry[] = [];
  const readStateEntry = createReadStateEntry(props, isBusy, isUnread);
  const labelsEntry = createLabelsEntry(props, isBusy, onOpenLabels);
  const folderEntries = createFolderEntries(props, isBusy);

  if (readStateEntry !== null) {
    entries.push(readStateEntry);
  }
  if (labelsEntry !== null) {
    entries.push(labelsEntry);
  }
  if (unsubscribeTarget !== null) {
    entries.push(createUnsubscribeEntry(props, isBusy, unsubscribeTarget));
  }
  if (folderEntries.length > 0) {
    entries.push({ id: "separator", type: "separator" }, ...folderEntries);
  }

  return entries;
};

const useMessageActionEntries = (props: MessageActionsSharedProps) => {
  const { actions } = props;
  const isUnread = props.isUnread ?? isMessageUnread(props.message);
  const isDraftMailbox = props.mailbox === "drafts";
  const isBusy = props.isPending === true;
  const [openLabelsDialog, setOpenLabelsDialog] = useState(false);
  const unsubscribeTarget = getMessageUnsubscribeTarget(props.message);

  if (isDraftMailbox) {
    return {
      dialogs: null,
      entries: createDraftEntries(props, isBusy),
      isBusy,
    };
  }

  const entries = createMessageActionEntries({
    isBusy,
    isUnread,
    onOpenLabels: () => {
      setOpenLabelsDialog(true);
    },
    props,
    unsubscribeTarget,
  });

  if (entries.length === 0) {
    return { dialogs: null, entries, isBusy };
  }

  const dialogs = actions.onUpdateLabels ? (
    <MessageActionsDialogs
      isPending={isBusy}
      mailboxId={props.mailboxId}
      message={props.message}
      onOpenLabelsDialog={setOpenLabelsDialog}
      onLabelsUpdate={actions.onUpdateLabels}
      openLabelsDialog={openLabelsDialog}
      threadLabelIds={props.threadLabelIds}
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
  if (entries.length === 0) {
    return dialogs;
  }

  return (
    <>
      <DropdownMenu>
        <IconButtonTooltip label="Message actions">
          <DropdownMenuTrigger
            aria-label="Open message actions"
            aria-busy={isBusy || undefined}
            className="inline-flex size-10 items-center justify-center rounded-md border border-border bg-bg shadow-sm hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
            disabled={isBusy}
            type="button"
          >
            <HugeiconsIcon
              aria-hidden
              className={cn("size-4", { "animate-spin": isBusy })}
              icon={isBusy ? Loading03Icon : MoreVerticalIcon}
            />
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
  if (entries.length === 0) {
    return children;
  }

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger className={triggerClassName} style={triggerStyle}>
          {children}
        </ContextMenuTrigger>

        <ContextMenuContent>
          {entries.map((entry) => renderContextEntry(entry))}
        </ContextMenuContent>
      </ContextMenu>

      {dialogs}
    </>
  );
};
