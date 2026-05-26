"use client";

import { Cancel01Icon, MoreVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Button,
  Checkbox,
  CheckboxIndicator,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButtonTooltip,
} from "@quieter/ui";
import type { MessageListBulkAction } from "./message-list-types";

const MessageListBulkActions = ({
  actions,
  disabled,
}: {
  actions: readonly MessageListBulkAction[];
  disabled: boolean;
}) => (
  <DropdownMenu>
    <IconButtonTooltip label="Bulk actions">
      <DropdownMenuTrigger
        aria-label="Open bulk actions"
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground shadow-sm outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-muted/80 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0"
        disabled={disabled || actions.length === 0}
        type="button"
      >
        <HugeiconsIcon aria-hidden icon={MoreVerticalIcon} />
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
}: {
  actions: readonly MessageListBulkAction[];
  allSelected: boolean;
  disabled: boolean;
  indeterminate: boolean;
  itemLabelPlural: string;
  onClearSelection: () => void;
  onToggleAll: (selected: boolean) => void;
  selectedCount: number;
}) => (
  <div className="bg-transparent p-4">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButtonTooltip label="Select all">
          <Checkbox
            aria-label={`Select all ${itemLabelPlural}`}
            checked={allSelected}
            className="size-[18px] rounded-[5px]"
            disabled={disabled}
            indeterminate={indeterminate}
            onCheckedChange={(checked) => {
              onToggleAll(checked);
            }}
          >
            <CheckboxIndicator />
          </Checkbox>
        </IconButtonTooltip>

        <p className="truncate text-sm font-medium text-foreground">{selectedCount} selected</p>
      </div>

      <div className="flex items-center gap-1">
        <MessageListBulkActions actions={actions} disabled={disabled || selectedCount === 0} />
        <IconButtonTooltip label="Clear selection">
          <Button
            aria-label="Clear selection"
            disabled={disabled}
            onClick={onClearSelection}
            size="icon-sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      </div>
    </div>
  </div>
);
