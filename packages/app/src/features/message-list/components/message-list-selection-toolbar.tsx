"use client";

import {
  Cancel01Icon,
  Loading03Icon,
  MoreHorizontalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import {
  AssistantSidebarContext,
  AssistantSidebarTrigger,
} from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { MessageLabelsMenu } from "@quieter/app/features/message-labels/components/message-labels-menu";
import type {
  MessageListBulkAction,
  MessageListBulkLabels,
} from "@quieter/app/features/message-list/components/message-list-types";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { use, useLayoutEffect, useRef, useState } from "react";

/** One 36px control plus the 8px gap that follows it. */
const ACTION_SLOT_WIDTH_PX = 44;
/** Select-all checkbox, its gap, and room for a five digit selection count. */
const SELECTION_SUMMARY_WIDTH_PX = 120;
/** Overflow menu, divider, and the clear button that always close the row. */
const TRAILING_CONTROLS_WIDTH_PX = 89;
const ASSISTANT_TRIGGER_SLOT_WIDTH_PX = 40;

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
  const [inlineActionCapacity, setInlineActionCapacity] = useState(0);

  useLayoutEffect((): (() => void) | undefined => {
    const row = rowRef.current;
    if (row === null) {
      return undefined;
    }

    const updateCapacity = (width: number) => {
      const capacity = Math.max(
        0,
        Math.min(
          availableActionCount,
          Math.floor((width - reservedWidth) / ACTION_SLOT_WIDTH_PX)
        )
      );
      setInlineActionCapacity(capacity);
    };
    updateCapacity(row.getBoundingClientRect().width);

    const observer = new ResizeObserver(([entry]) => {
      updateCapacity(entry?.contentRect.width ?? 0);
    });
    observer.observe(row);

    return () => {
      observer.disconnect();
    };
  }, [availableActionCount, reservedWidth]);

  return {
    inlineActionCapacity,
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
      disabled={disabled}
      onClick={() => {
        void action.onSelect();
      }}
      size="icon"
      type="button"
      variant={action.destructive === true ? "destructive" : "outline"}
    >
      <Icon aria-hidden icon={action.icon} />
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
          render={<Button size="icon" variant="outline" />}
          disabled={disabled}
          type="button"
        >
          <Icon aria-hidden icon={Tag01Icon} />
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
        render={<Button size="icon" variant="outline" />}
        disabled={disabled}
        type="button"
      >
        <Icon aria-hidden icon={MoreHorizontalIcon} />
      </DropdownMenuTrigger>
    </IconButtonTooltip>

    <DropdownMenuContent align="end">
      {actions.map((action) => (
        <DropdownMenuItem
          key={action.id}
          onSelect={() => {
            void action.onSelect();
          }}
          tone={action.destructive === true ? "destructive" : undefined}
        >
          <Icon aria-hidden icon={action.icon} />
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
  const assistant = use(AssistantSidebarContext);
  const assistantTriggerVisible = assistant !== null && !assistant.open;
  const promotedActions = actions.filter((action) => action.promoted === true);
  const { inlineActionCapacity, rowRef } = useInlineActionCapacity({
    availableActionCount: promotedActions.length,
    reservedWidth:
      SELECTION_SUMMARY_WIDTH_PX +
      TRAILING_CONTROLS_WIDTH_PX +
      (labels === null ? 0 : ACTION_SLOT_WIDTH_PX) +
      (assistantTriggerVisible ? ASSISTANT_TRIGGER_SLOT_WIDTH_PX : 0),
  });
  const inlineActions = promotedActions.slice(0, inlineActionCapacity);
  const inlineActionIds = new Set(inlineActions.map((action) => action.id));
  const overflowActions = actions.filter(
    (action) => !inlineActionIds.has(action.id)
  );
  const actionsDisabled = disabled || selectedCount === 0;

  return (
    <div
      className="flex h-8 min-w-0 items-stretch justify-between gap-2"
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
            disabled={disabled}
            indeterminate={indeterminate}
            onCheckedChange={(checked) => {
              onToggleAll(checked);
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
        </IconButtonTooltip>

        <p className="truncate text-body font-medium text-fg">
          {selectedCount} selected
        </p>

        {pending && (
          <Icon
            aria-hidden
            size={14}
            animation="spin"
            tone="muted"

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
            disabled={disabled}
            onClick={onClearSelection}
            size="icon"
            type="button"
            variant="outline"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
        <AssistantSidebarTrigger className="data-[sidebar-open=true]:-ms-2" />
      </div>

      {pending && (
        <output aria-live="polite" className="sr-only">
          Updating selected {itemLabelPlural}…
        </output>
      )}
    </div>
  );
};
