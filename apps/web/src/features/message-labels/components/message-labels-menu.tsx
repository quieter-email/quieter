"use client";

import { Loading03Icon, Tag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSubmenu,
  DropdownMenuSubmenuContent,
  DropdownMenuSubmenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";

import type {
  MessageLabelsTarget,
  MessageLabelsUpdate,
} from "#/features/message-labels/domain/message-label-updates";
import {
  getMessageLabelSelection,
  getMessageLabelUpdates,
} from "#/features/message-labels/domain/message-label-updates";
import { getUserLabels } from "#/features/message-search/state/message-list-search-state";
import { toastError } from "#/lib/error-toast";
import { labelsQueryOptions } from "#/lib/gmail/labels-query";

type MessageLabelsMenuItemsProps = {
  isPending: boolean;
  mailboxId: string;
  onApply: (updates: MessageLabelsUpdate[]) => void | Promise<void>;
  open: boolean;
  targets: readonly MessageLabelsTarget[];
};

const MessageLabelsMenuItems = ({
  isPending,
  mailboxId,
  onApply,
  open,
  targets,
}: MessageLabelsMenuItemsProps) => {
  const {
    data: labels,
    error: labelsError,
    isError,
    isPending: areLabelsPending,
  } = useQuery(labelsQueryOptions(mailboxId, open));

  const toggleLabel = async (labelId: string, checked: boolean) => {
    const updates = getMessageLabelUpdates(targets, { [labelId]: checked });
    if (updates.length === 0) {
      return;
    }

    try {
      await onApply(updates);
    } catch (error) {
      toastError(error, {
        boundary: "label-actions",
        fallback: "Could not update labels.",
      });
    }
  };

  if (areLabelsPending) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2 text-body text-muted-fg">
        <HugeiconsIcon
          aria-hidden
          className="size-4 animate-spin"
          icon={Loading03Icon}
        />
        <span>Loading labels…</span>
      </div>
    );
  }

  if (isError && !labels) {
    return (
      <p className="px-2.5 py-2 text-body text-destructive">
        {labelsError?.message ?? "Could not load labels."}
      </p>
    );
  }

  const userLabels = getUserLabels(labels ?? []);
  if (userLabels.length === 0) {
    return (
      <p className="px-2.5 py-2 text-body text-muted-fg">No custom labels.</p>
    );
  }

  return (
    <>
      {userLabels.map((label) => {
        const selection = getMessageLabelSelection(targets, label.id);

        return (
          <DropdownMenuCheckboxItem
            checked={selection === "all"}
            disabled={isPending}
            indeterminate={selection === "some"}
            key={label.id}
            onCheckedChange={(checked) => {
              void toggleLabel(label.id, checked);
            }}
          >
            <span className="min-w-0 truncate">{label.name}</span>
          </DropdownMenuCheckboxItem>
        );
      })}
    </>
  );
};

/** Labels picker nested inside an existing message actions menu. */
export const MessageLabelsSubmenu = ({
  disabled = false,
  isPending,
  label,
  mailboxId,
  onApply,
  targets,
}: Omit<MessageLabelsMenuItemsProps, "open"> & {
  disabled?: boolean;
  label: string;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenuSubmenu
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
      }}
      open={open}
    >
      <DropdownMenuSubmenuTrigger disabled={disabled}>
        <span className="flex min-w-0 items-center gap-2">
          <HugeiconsIcon
            aria-hidden
            className="size-4 shrink-0"
            icon={Tag01Icon}
          />
          <span className="truncate">{label}</span>
        </span>
      </DropdownMenuSubmenuTrigger>

      <DropdownMenuSubmenuContent className="max-h-72">
        <MessageLabelsMenuItems
          isPending={isPending}
          mailboxId={mailboxId}
          onApply={onApply}
          open={open}
          targets={targets}
        />
      </DropdownMenuSubmenuContent>
    </DropdownMenuSubmenu>
  );
};

/** Standalone labels picker for a caller-provided trigger. */
export const MessageLabelsMenu = ({
  isPending,
  mailboxId,
  onApply,
  onOpenChange,
  open,
  targets,
  trigger,
}: MessageLabelsMenuItemsProps & {
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
}) => (
  <DropdownMenu
    onOpenChange={(nextOpen) => {
      onOpenChange(nextOpen);
    }}
    open={open}
  >
    {trigger}

    <DropdownMenuContent align="end" className="max-h-72">
      <MessageLabelsMenuItems
        isPending={isPending}
        mailboxId={mailboxId}
        onApply={onApply}
        open={open}
        targets={targets}
      />
    </DropdownMenuContent>
  </DropdownMenu>
);
