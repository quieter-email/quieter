"use client";

import {
  Cancel01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { useLayoutEffect, useRef, useState } from "react";

import { MessageLabelsMenu } from "#/features/message-labels/components/message-labels-menu";

import { messageListHeaderControlVariants } from "./message-list-header-surfaces";
import type {
  MessageListBulkAction,
  MessageListBulkLabels,
} from "./message-list-types";

/** One 36px control plus the 8px gap that follows it. */
const ACTION_SLOT_WIDTH_PX = 44;
/** Select-all checkbox, its gap, and room for a five digit selection count. */
const SELECTION_SUMMARY_WIDTH_PX = 120;
/** Overflow menu, divider, and the clear button that always close the row. */
const TRAILING_CONTROLS_WIDTH_PX = 89;

/**
 * Promotes as many actions to their own button as the header row can hold.
 * The list lives in a resizable panel, so the row is measured rather than
 * guessed at a breakpoint, seeded before first paint so nothing pops in.
 */
const useInlineActionCapacity = ({
  availableActionCount,
  reservedWidth,
}: {
  availableActionCount: number;
  reservedWidth: number;
}) => {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const [rowWidth, setRowWidth] = useState(0);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row === null) {
      return () => {
        // Nothing to observe before the row is mounted.
      };
    }

    setRowWidth(row.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      setRowWidth(entry?.contentRect.width ?? 0);
    });
    observer.observe(row);

    return () => {
      observer.disconnect();
    };
  }, []);

  return {
    inlineActionCapacity: Math.max(
      0,
      Math.min(
        availableActionCount,
        Math.floor((rowWidth - reservedWidth) / ACTION_SLOT_WIDTH_PX)
      )
    ),
    rowRef,
  };
};

const MessageListBulkActionButton = ({
  action,
  disabled,
}: {
  action: MessageListBulkAction;
  disabled: boolean;
}) => (
  <IconButtonTooltip label={action.label}>
    <Button
      aria-label={action.label}
      className={cn(messageListHeaderControlVariants({ control: "toolbar" }), {
        "hover:text-destructive": action.destructive === true,
      })}
      disabled={disabled}
      onClick={() => {
        void action.onSelect();
      }}
      size="icon"
      type="button"
      variant="ghost"
    >
      <HugeiconsIcon aria-hidden icon={action.icon} />
    </Button>
  </IconButtonTooltip>
);

const MessageListBulkLabelsMenu = ({
  disabled,
  labels,
}: {
  disabled: boolean;
  labels: MessageListBulkLabels;
}) => (
  <MessageLabelsMenu
    {...labels}
    trigger={
      <IconButtonTooltip label="Labels">
        <DropdownMenuTrigger
          aria-label="Modify labels"
          className={messageListHeaderControlVariants({ control: "trigger" })}
          disabled={disabled}
          type="button"
        >
          <HugeiconsIcon aria-hidden icon={Tag01Icon} />
        </DropdownMenuTrigger>
      </IconButtonTooltip>
    }
  />
);

const MessageListBulkOverflowMenu = ({
  actions,
  disabled,
}: {
  actions: readonly MessageListBulkAction[];
  disabled: boolean;
}) => (
  <DropdownMenu>
    <IconButtonTooltip label="More actions">
      <DropdownMenuTrigger
        aria-label="Open more actions"
        className={messageListHeaderControlVariants({ control: "trigger" })}
        disabled={disabled}
        type="button"
      >
        <HugeiconsIcon aria-hidden icon={MoreHorizontalIcon} />
      </DropdownMenuTrigger>
    </IconButtonTooltip>

    <DropdownMenuContent align="end">
      {actions.map((action) => (
        <DropdownMenuItem
          className={cn({ "text-destructive": action.destructive === true })}
          key={action.id}
          onSelect={() => {
            void action.onSelect();
          }}
        >
          <HugeiconsIcon aria-hidden className="size-4" icon={action.icon} />
          <span>{action.label}</span>
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export const MessageListSelectionToolbar = ({
  actions,
  allSelected,
  disabled,
  indeterminate,
  itemLabelPlural,
  labels,
  onClearSelection,
  onToggleAll,
  pending,
  selectedCount,
}: {
  actions: readonly MessageListBulkAction[];
  allSelected: boolean;
  disabled: boolean;
  indeterminate: boolean;
  itemLabelPlural: string;
  labels: MessageListBulkLabels | null;
  onClearSelection: () => void;
  onToggleAll: (selected: boolean) => void;
  pending: boolean;
  selectedCount: number;
}) => {
  const promotedActions = actions.filter((action) => action.promoted === true);
  const { inlineActionCapacity, rowRef } = useInlineActionCapacity({
    availableActionCount: promotedActions.length,
    reservedWidth:
      SELECTION_SUMMARY_WIDTH_PX +
      TRAILING_CONTROLS_WIDTH_PX +
      (labels === null ? 0 : ACTION_SLOT_WIDTH_PX),
  });
  const inlineActions = promotedActions.slice(0, inlineActionCapacity);
  const inlineActionIds = new Set(inlineActions.map((action) => action.id));
  const overflowActions = actions.filter(
    (action) => !inlineActionIds.has(action.id)
  );
  const actionsDisabled = disabled || selectedCount === 0;

  return (
    <div
      className="flex h-9 min-w-0 items-stretch justify-between gap-2"
      ref={rowRef}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButtonTooltip
          label={allSelected ? "Clear selection" : "Select all"}
        >
          <Checkbox
            aria-label={
              allSelected
                ? `Clear selected ${itemLabelPlural}`
                : `Select all loaded ${itemLabelPlural}`
            }
            checked={allSelected}
            className="size-4.5 rounded-[5px]"
            disabled={disabled}
            indeterminate={indeterminate}
            onCheckedChange={(checked) => {
              onToggleAll(checked);
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
        </IconButtonTooltip>

        <p className="truncate text-sm font-medium text-fg">
          {selectedCount} selected
        </p>

        {pending && (
          <HugeiconsIcon
            aria-hidden
            className="size-3.5 shrink-0 animate-spin text-muted-fg"
            icon={Loading03Icon}
          />
        )}
      </div>

      <div className="flex shrink-0 items-stretch gap-2">
        {inlineActions.map((action) => (
          <MessageListBulkActionButton
            action={action}
            disabled={actionsDisabled}
            key={action.id}
          />
        ))}

        {labels !== null && (
          <MessageListBulkLabelsMenu
            disabled={actionsDisabled}
            labels={labels}
          />
        )}

        {overflowActions.length > 0 && (
          <MessageListBulkOverflowMenu
            actions={overflowActions}
            disabled={actionsDisabled}
          />
        )}

        <div aria-hidden className="my-1.5 w-px shrink-0 bg-border" />

        <IconButtonTooltip label="Clear selection">
          <Button
            aria-label="Clear selection"
            className={messageListHeaderControlVariants({ control: "toolbar" })}
            disabled={disabled}
            onClick={onClearSelection}
            size="icon"
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>

      {pending && (
        <output aria-live="polite" className="sr-only">
          Updating selected {itemLabelPlural}…
        </output>
      )}
    </div>
  );
};
