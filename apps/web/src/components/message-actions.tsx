"use client";

import type { CSSProperties, PropsWithChildren } from "react";
import {
  Delete01Icon,
  Delete02Icon,
  Edit01Icon,
  Loading03Icon,
  Mail01Icon,
  MailOpen02Icon,
  MoreVerticalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  Button,
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButtonTooltip,
} from "@quietr/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getErrorMessage } from "~/lib/errors";
import {
  type GmailLabelListItem,
  isMessageUnread,
  type MailboxCategory,
  type MessageListItem,
} from "~/lib/gmail/gmail";
import { labelsQueryOptions } from "~/lib/gmail/labels-query";

type LabelChanges = {
  addLabelIds?: string[];
  removeLabelIds?: string[];
};

type MessageActionsSharedProps = {
  message: MessageListItem;
  mailbox: MailboxCategory;
  isUnread?: boolean;
  onDeleteDraft?: (message: MessageListItem) => void | Promise<void>;
  onMarkAsRead?: (messageId: string) => void | Promise<void>;
  onMarkAsSpam?: (messageId: string) => void | Promise<void>;
  onMarkAsUnread?: (messageId: string) => void | Promise<void>;
  onOpenDraft?: (message: MessageListItem) => void | Promise<void>;
  onUpdateLabels?: (messageId: string, changes: LabelChanges) => void | Promise<void>;
  onMoveToTrash?: (messageId: string) => void | Promise<void>;
  onUnmarkAsSpam?: (messageId: string) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
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

const getUserLabels = (labels: readonly GmailLabelListItem[]): GmailLabelListItem[] =>
  labels.filter((label) => label.type === "user");

const renderDropdownEntry = (entry: MenuEntry) => {
  if (entry.type === "separator") {
    return <DropdownMenuSeparator key={entry.id} />;
  }

  return (
    <DropdownMenuItem
      className={entry.destructive ? "text-destructive" : undefined}
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
      className={entry.destructive ? "text-destructive" : undefined}
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
  isTrashMailbox,
  message,
  onDeletePermanently,
  onOpenDeleteDialog,
  onOpenLabelsDialog,
  onUpdateLabels,
  openDeleteDialog,
  openLabelsDialog,
}: {
  message: MessageListItem;
  isPending: boolean;
  isTrashMailbox: boolean;
  openLabelsDialog: boolean;
  onOpenLabelsDialog: (open: boolean) => void;
  openDeleteDialog: boolean;
  onOpenDeleteDialog: (open: boolean) => void;
  onUpdateLabels?: (messageId: string, changes: LabelChanges) => void | Promise<void>;
  onDeletePermanently?: (messageId: string) => void | Promise<void>;
}) => {
  const labelsQuery = useQuery(labelsQueryOptions(openLabelsDialog));
  const userLabels = getUserLabels(labelsQuery.data ?? []);
  const currentUserLabelIds = (message.labelIds ?? []).filter((labelId) =>
    userLabels.some((label) => label.id === labelId),
  );

  const [draftLabelIds, setDraftLabelIds] = useState<string[] | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isApplyingLabels, setIsApplyingLabels] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const selectedLabelIds = draftLabelIds ?? currentUserLabelIds;
  const labelsChanged = !areStringArraysEqual(currentUserLabelIds, selectedLabelIds);
  const isLabelsBusy = isPending || isApplyingLabels;
  const isDeleteBusy = isPending || isDeleting;

  const toggleDraftLabel = (labelId: string, checked: boolean) => {
    setDraftLabelIds((current) => {
      const nextCurrent = current ?? currentUserLabelIds;

      if (checked) {
        if (nextCurrent.includes(labelId)) return nextCurrent;
        return [...nextCurrent, labelId];
      }

      return nextCurrent.filter((value) => value !== labelId);
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

    setIsApplyingLabels(true);
    setLabelError(null);

    try {
      await onUpdateLabels(message.id, {
        addLabelIds,
        removeLabelIds,
      });
      onOpenLabelsDialog(false);
    } catch (error) {
      setLabelError(getErrorMessage(error, "Could not update labels."));
    } finally {
      setIsApplyingLabels(false);
    }
  };

  const confirmDelete = async () => {
    if (!onDeletePermanently || !isTrashMailbox || isDeleteBusy) return;

    setIsDeleting(true);
    setDeleteError(null);

    try {
      await onDeletePermanently(message.id);
      onOpenDeleteDialog(false);
    } catch (error) {
      setDeleteError(getErrorMessage(error, "Could not delete this message."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Dialog
        onOpenChange={(open) => {
          onOpenLabelsDialog(open);
          setDraftLabelIds(null);
          setLabelError(null);
          if (!open) setIsApplyingLabels(false);
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
                <span>Loading labels...</span>
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

            {labelError ? <p className="text-sm text-destructive">{labelError}</p> : null}
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

      <Dialog
        onOpenChange={(open) => {
          onOpenDeleteDialog(open);
          if (!open) {
            setDeleteError(null);
            setIsDeleting(false);
          }
        }}
        open={openDeleteDialog}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete permanently?</DialogTitle>
            <DialogDescription>This action cannot be undone.</DialogDescription>
          </DialogHeader>

          <DialogBody>
            {deleteError ? <p className="text-sm text-destructive">{deleteError}</p> : null}
          </DialogBody>

          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button
              disabled={isDeleteBusy}
              onClick={() => void confirmDelete()}
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

const useMessageActionEntries = (props: MessageActionsSharedProps) => {
  const isUnread = props.isUnread ?? isMessageUnread(props.message);
  const isDraftMailbox = props.mailbox === "drafts";
  const isSpamMailbox = props.mailbox === "spam";
  const isTrashMailbox = props.mailbox === "trash";
  const isBusy = Boolean(props.isPending);
  const [openLabelsDialog, setOpenLabelsDialog] = useState(false);
  const [openDeleteDialog, setOpenDeleteDialog] = useState(false);
  const showMarkAsSpam = props.mailbox === "inbox";

  if (isDraftMailbox) {
    return {
      dialogs: null,
      entries: [
        {
          type: "item",
          id: "open-draft",
          disabled: isBusy || !props.onOpenDraft,
          icon: Edit01Icon,
          label: "Open draft",
          onSelect: () => {
            void props.onOpenDraft?.(props.message);
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
          disabled: isBusy || !props.onDeleteDraft,
          icon: Delete02Icon,
          label: "Delete draft",
          onSelect: () => {
            void props.onDeleteDraft?.(props.message);
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
      disabled: isBusy || (isUnread ? !props.onMarkAsRead : !props.onMarkAsUnread),
      icon: isUnread ? MailOpen02Icon : Mail01Icon,
      label: isUnread ? "Mark as Read" : "Mark as Unread",
      onSelect: () => {
        if (isUnread) {
          void props.onMarkAsRead?.(props.message.id);
          return;
        }

        void props.onMarkAsUnread?.(props.message.id);
      },
    },
    {
      type: "item",
      id: "modify-labels",
      disabled: isBusy || !props.onUpdateLabels,
      icon: Tag01Icon,
      label: "Modify Labels",
      onSelect: () => setOpenLabelsDialog(true),
    },
    {
      type: "separator",
      id: "separator",
    },
    ...(showMarkAsSpam
      ? [
          {
            type: "item" as const,
            id: "mark-as-spam",
            destructive: true,
            disabled: isBusy || !props.onMarkAsSpam,
            icon: Delete02Icon,
            label: "Mark as Spam",
            onSelect: () => {
              void props.onMarkAsSpam?.(props.message.id);
            },
          },
        ]
      : []),
    ...(isSpamMailbox
      ? [
          {
            type: "item" as const,
            id: "unmark-as-spam",
            disabled: isBusy || !props.onUnmarkAsSpam,
            icon: Mail01Icon,
            label: "Unmark as Spam",
            onSelect: () => {
              void props.onUnmarkAsSpam?.(props.message.id);
            },
          },
        ]
      : []),
    {
      type: "item",
      id: isTrashMailbox ? "delete-permanently" : "move-to-trash",
      destructive: true,
      disabled: isBusy || (isTrashMailbox ? !props.onDeletePermanently : !props.onMoveToTrash),
      icon: isTrashMailbox ? Delete02Icon : Delete01Icon,
      label: isTrashMailbox ? "Delete permanently" : "Move to Trash",
      onSelect: () => {
        if (isTrashMailbox) {
          setOpenDeleteDialog(true);
          return;
        }

        void props.onMoveToTrash?.(props.message.id);
      },
    },
  ];

  const dialogs = (
    <MessageActionsDialogs
      isPending={isBusy}
      isTrashMailbox={isTrashMailbox}
      message={props.message}
      onDeletePermanently={props.onDeletePermanently}
      onOpenDeleteDialog={setOpenDeleteDialog}
      onOpenLabelsDialog={setOpenLabelsDialog}
      onUpdateLabels={props.onUpdateLabels}
      openDeleteDialog={openDeleteDialog}
      openLabelsDialog={openLabelsDialog}
    />
  );

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
            className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background shadow-sm transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50"
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
