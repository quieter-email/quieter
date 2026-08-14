"use client";

import {
  Cancel01Icon,
  Loading03Icon,
  MoreVerticalIcon,
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

import type { MessageListBulkAction } from "./message-list-types";

const MessageListBulkActions = ({
  actions,
  disabled,
  pending,
}: {
  actions: readonly MessageListBulkAction[];
  disabled: boolean;
  pending: boolean;
}) => (
  <DropdownMenu>
    <IconButtonTooltip label="Bulk actions">
      <DropdownMenuTrigger
        aria-label="Open bulk actions"
        aria-busy={pending || undefined}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-transparent bg-secondary/55 text-muted-fg shadow-none hover:bg-muted hover:text-fg active:bg-muted/80 active:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0"
        disabled={disabled || actions.length === 0}
        type="button"
      >
        <HugeiconsIcon
          aria-hidden
          className={cn({ "animate-spin": pending })}
          icon={pending ? Loading03Icon : MoreVerticalIcon}
        />
      </DropdownMenuTrigger>
    </IconButtonTooltip>

    <DropdownMenuContent align="end">
      {actions.map((action) => (
        <div key={action.id}>
          <DropdownMenuItem
            className={cn({ "text-destructive": action.destructive })}
            onSelect={() => {
              void action.onSelect();
            }}
          >
            <HugeiconsIcon aria-hidden className="size-4" icon={action.icon} />
            <span>{action.label}</span>
          </DropdownMenuItem>
        </div>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
);

export const MessageListSelectionToolbar = ({
  allSelected,
  disabled,
  indeterminate,
  itemLabelPlural,
  onClearSelection,
  onToggleAll,
  selectedCount,
  actions,
  pending,
}: {
  actions: readonly MessageListBulkAction[];
  allSelected: boolean;
  disabled: boolean;
  indeterminate: boolean;
  itemLabelPlural: string;
  onClearSelection: () => void;
  onToggleAll: (selected: boolean) => void;
  selectedCount: number;
  pending: boolean;
}) => (
  <div className="bg-transparent p-2 @sm:px-4 @sm:pt-4 @sm:pb-3">
    <div className="flex min-w-0 items-stretch justify-between gap-2 lg:-ml-2">
      <div className="flex min-w-0 items-center gap-2">
        <IconButtonTooltip label="Select all">
          <Checkbox
            aria-label={`Select all ${itemLabelPlural}`}
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
      </div>

      <div className="flex items-center gap-2">
        <MessageListBulkActions
          actions={actions}
          disabled={disabled || selectedCount === 0}
          pending={pending}
        />
        <IconButtonTooltip label="Clear selection">
          <Button
            aria-label="Clear selection"
            className="rounded-xl bg-secondary/55 text-muted-fg shadow-none hover:bg-muted hover:text-fg [&_svg]:size-3.5"
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
  </div>
);
