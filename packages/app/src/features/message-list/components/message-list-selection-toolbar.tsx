"use client";

import {
  Cancel01Icon,
  MoreHorizontalIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { MessageLabelsMenu } from "@quieter/app/features/message-labels/components/message-labels-menu";
import type {
  MessageListBulkAction,
  MessageListBulkLabels,
} from "@quieter/app/features/message-list/components/message-list-types";
import { getAppPresenceMotion } from "@quieter/app/features/motion/app-motion";
import { Button } from "@quieter/ui/button";
import { Checkbox, CheckboxIndicator } from "@quieter/ui/checkbox";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Surface } from "@quieter/ui/surface";
import {
  AnimatePresence,
  LazyMotion,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";

/** Promoted actions that get their own button once the list is wide enough. */
const INLINE_ACTION_LIMIT = 3;

/**
 * Floats the selection tray over the bottom of the list panel. The search
 * header stays in place, so the tray rises from and sinks back into the edge.
 */
export const MessageListSelectionTray = ({
  children,
}: {
  children: ReactNode | null;
}) => {
  const reducedMotion = useReducedMotion();
  const presence = getAppPresenceMotion({ distance: 8, reducedMotion });

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center px-2 @sm:px-4">
      <LazyMotion features={domAnimation}>
        <AnimatePresence>
          {children === null ? null : (
            <m.div
              animate={presence.animate}
              className="pointer-events-auto max-w-full min-w-0"
              exit={{ ...presence.initial, pointerEvents: "none" }}
              initial={presence.initial}
              key="selection"
              transition={presence.transition}
            >
              {children}
            </m.div>
          )}
        </AnimatePresence>
      </LazyMotion>
    </div>
  );
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
      chrome="toolbar"
      aria-label={action.label}
      disabled={disabled}
      onClick={() => {
        void action.onSelect();
      }}
      size="icon"
      type="button"
      variant={action.destructive === true ? "destructive" : "ghost"}
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
          chrome="toolbar"
          aria-label="Modify labels"
          render={<Button chrome="toolbar" size="icon" variant="ghost" />}
          disabled={disabled}
          type="button"
        >
          <Icon aria-hidden icon={Tag01Icon} />
        </DropdownMenuTrigger>
      </IconButtonTooltip>
    }
  />
);

const MessageListBulkActionsMenu = ({
  actions,
  disabled,
}: {
  actions: readonly MessageListBulkAction[];
  disabled: boolean;
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      chrome="toolbar"
      render={<Button chrome="toolbar" variant="outline" />}
      disabled={disabled}
      type="button"
    >
      <Icon aria-hidden icon={MoreHorizontalIcon} />
      <span>Actions</span>
    </DropdownMenuTrigger>

    <DropdownMenuContent align="center" side="top">
      {actions.map((action) => (
        <DropdownMenuItem
          disabled={disabled || action.disabled === true}
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
  const inlineActions = actions
    .filter((action) => action.promoted === true)
    .slice(0, INLINE_ACTION_LIMIT);
  const actionsDisabled = disabled || selectedCount === 0;
  const hasEnabledActions = actions.some((action) => action.disabled !== true);

  return (
    <section aria-label={`Selected ${itemLabelPlural}`}>
      <Surface padding="tray" variant="floating">
        <div className="flex min-w-0 items-center gap-2.5 ps-2 pe-1.5">
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

          <p className="truncate text-body-sm font-medium text-fg tabular-nums">
            {selectedCount} selected
          </p>
        </div>

        {inlineActions.map((action, index) => (
          <span
            className={cn("hidden", {
              "@md:contents": index < 2,
              "@xl:contents": index >= 2,
            })}
            key={action.id}
          >
            <MessageListBulkActionButton
              action={action}
              disabled={actionsDisabled || action.disabled === true}
            />
          </span>
        ))}

        {labels !== null && (
          <MessageListBulkLabelsMenu
            disabled={actionsDisabled}
            labels={labels}
          />
        )}

        {actions.length > 0 && (
          <MessageListBulkActionsMenu
            actions={actions}
            disabled={actionsDisabled || !hasEnabledActions}
          />
        )}

        <div aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-fg/10" />

        <IconButtonTooltip label="Clear selection">
          <Button
            chrome="toolbar"
            aria-label="Clear selection"
            disabled={disabled}
            onClick={onClearSelection}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>

        {pending && (
          <output aria-live="polite" className="sr-only">
            Updating selected {itemLabelPlural}…
          </output>
        )}
      </Surface>
    </section>
  );
};
