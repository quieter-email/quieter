"use client";

import type { CSSProperties, PropsWithChildren } from "react";
import {
  ArrowUpRight01Icon,
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  InboxIcon,
  Loading03Icon,
  Mail01Icon,
  MailOpen02Icon,
  MoreVerticalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Button,
  cn,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButtonTooltip,
} from "@quieter/ui";
import { useQuery } from "@tanstack/react-query";
import { useReducer, useState } from "react";
import { getUserLabels } from "~/features/message-search/state/message-list-search-state";
import { isMessageUnread, type MailboxCategory, type MessageListItem } from "~/lib/gmail/gmail";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";
import type { LabelChanges, ThreadActionHandlers } from "./message-action-handlers";
import { getMessageUnsubscribeTarget, openUnsubscribeUrl } from "./message-unsubscribe";

type MessageActionsSharedProps = {
  actions: ThreadActionHandlers;
  mailboxId: string;
  message: MessageListItem;
  mailbox: MailboxCategory;
  isUnread?: boolean;
  isPending?: boolean;
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

const areStringArraysEqual = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) return false;

  const rightSet = new Set(right);
  for (const value of left) {
    if (!rightSet.has(value)) return false;
  }

  return true;
};

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

type MessageActionsDialogsState = {
  draftLabelIds: string[] | null;
  isApplyingLabels: boolean;
  labelError: string | null;
};

type MessageActionsDialogsAction =
  | {
      checked: boolean;
      currentUserLabelIds: readonly string[];
      labelId: string;
      type: "labels/toggle";
    }
  | {
      type: "labels/error";
      value: string | null;
    }
  | {
      type: "labels/pending";
      value: boolean;
    }
  | {
      type: "labels/reset";
    };

const initialMessageActionsDialogsState: MessageActionsDialogsState = {
  draftLabelIds: null,
  isApplyingLabels: false,
  labelError: null,
};

const messageActionsDialogsReducer = (
  state: MessageActionsDialogsState,
  action: MessageActionsDialogsAction,
): MessageActionsDialogsState => {
  switch (action.type) {
    case "labels/toggle": {
      const nextCurrent = state.draftLabelIds ?? [...action.currentUserLabelIds];

      return {
        ...state,
        draftLabelIds: action.checked
          ? nextCurrent.includes(action.labelId)
            ? nextCurrent
            : [...nextCurrent, action.labelId]
          : nextCurrent.filter((value) => value !== action.labelId),
      };
    }
    case "labels/error":
      return {
        ...state,
        labelError: action.value,
      };
    case "labels/pending":
      return {
        ...state,
        isApplyingLabels: action.value,
      };
    case "labels/reset":
      return {
        ...state,
        draftLabelIds: null,
        isApplyingLabels: false,
        labelError: null,
      };
  }
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
  const labelsQuery = useQuery(labelsQueryOptions(mailboxId, openLabelsDialog));
  const userLabels = getUserLabels(labelsQuery.data ?? []);
  const currentUserLabelIds = (message.labelIds ?? []).filter((labelId) =>
    userLabels.some((label) => label.id === labelId),
  );
  const [state, dispatch] = useReducer(
    messageActionsDialogsReducer,
    initialMessageActionsDialogsState,
  );
  const selectedLabelIds = state.draftLabelIds ?? currentUserLabelIds;
  const labelsChanged = !areStringArraysEqual(currentUserLabelIds, selectedLabelIds);
  const isLabelsBusy = isPending || state.isApplyingLabels;

  const toggleDraftLabel = (labelId: string, checked: boolean) => {
    dispatch({
      checked,
      currentUserLabelIds,
      labelId,
      type: "labels/toggle",
    });
  };

  const applyLabels = async () => {
    if (!onUpdateLabels || isLabelsBusy) return;

    const nextLabelIdSet = new Set(selectedLabelIds);
    const addLabelIds = selectedLabelIds.filter(
      (labelId) => !currentUserLabelIds.includes(labelId),
    );
    const removeLabelIds = currentUserLabelIds.filter((labelId) => !nextLabelIdSet.has(labelId));

    if (addLabelIds.length === 0 && removeLabelIds.length === 0) {
      onOpenLabelsDialog(false);
      return;
    }

    dispatch({
      type: "labels/pending",
      value: true,
    });
    dispatch({
      type: "labels/error",
      value: null,
    });

    try {
      await onUpdateLabels(message.threadId, {
        addLabelIds,
        removeLabelIds,
      });
      onOpenLabelsDialog(false);
      dispatch({
        type: "labels/pending",
        value: false,
      });
    } catch (error) {
      dispatch({
        type: "labels/error",
        value: error instanceof Error && error.message ? error.message : "Could not update labels.",
      });
      dispatch({
        type: "labels/pending",
        value: false,
      });
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        onOpenLabelsDialog(open);
        dispatch({ type: "labels/reset" });
      }}
      open={openLabelsDialog}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modify Labels</DialogTitle>
        </DialogHeader>

        <DialogBody className="max-h-[50vh] space-y-3 overflow-y-auto">
          {labelsQuery.isPending ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon aria-hidden className="animate-spin" icon={Loading03Icon} />
              <span>Loading labels…</span>
            </div>
          ) : labelsQuery.isError ? (
            <p className="text-sm text-destructive">
              {labelsQuery.error?.message ?? "Could not load labels."}
            </p>
          ) : userLabels.length > 0 ? (
            <div className="space-y-2">
              {userLabels.map((label) => (
                <label className="flex items-center gap-2 text-sm text-foreground" key={label.id}>
                  <input
                    aria-label={label.name}
                    checked={selectedLabelIds.includes(label.id)}
                    className="size-4 rounded-md accent-foreground"
                    disabled={isLabelsBusy}
                    onChange={(event) => toggleDraftLabel(label.id, event.currentTarget.checked)}
                    type="checkbox"
                  />
                  <span>{label.name}</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No custom labels.</p>
          )}

          {state.labelError && <p className="text-sm text-destructive">{state.labelError}</p>}
        </DialogBody>

        <DialogFooter>
          <DialogCloseButton>Cancel</DialogCloseButton>
          <Button
            disabled={
              !labelsChanged || labelsQuery.isPending || labelsQuery.isError || isLabelsBusy
            }
            onClick={() => void applyLabels()}
          >
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const useMessageActionEntries = (props: MessageActionsSharedProps) => {
  const actions = props.actions;
  const isUnread = props.isUnread ?? isMessageUnread(props.message);
  const isDraftMailbox = props.mailbox === "drafts";
  const isSpamMailbox = props.mailbox === "spam";
  const isTrashMailbox = props.mailbox === "trash";
  const isBusy = !!props.isPending;
  const [openLabelsDialog, setOpenLabelsDialog] = useState(false);
  const showMarkAsSpam = props.mailbox === "inbox";
  const unsubscribeTarget = getMessageUnsubscribeTarget(props.message);
  const hasFolderAction =
    (showMarkAsSpam && !!actions.onMarkAsSpam) ||
    (isSpamMailbox && !!actions.onUnmarkAsSpam) ||
    (isTrashMailbox && !!actions.onUntrash) ||
    (!isTrashMailbox && !!actions.onMoveToTrash);

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

  const entries: MenuEntry[] = [
    {
      type: "item",
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
    ...(actions.onUpdateLabels
      ? [
          {
            type: "item" as const,
            id: "modify-labels",
            disabled: isBusy,
            icon: Tag01Icon,
            label: "Modify Labels",
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
    ...(isTrashMailbox && actions.onUntrash
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
