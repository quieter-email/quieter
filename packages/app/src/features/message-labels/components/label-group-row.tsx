"use client";

import {
  Add01Icon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  Delete01Icon,
  Edit01Icon,
  FolderAddIcon,
  MoreVerticalIcon,
} from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { settingsSurfaceVariants } from "@quieter/ui/settings-layout";
import { Text } from "@quieter/ui/text";
import type { ReactNode } from "react";

import type { LabelGroup } from "../domain/label-group-tree";
import { MailboxLabelSwatch } from "./mailbox-label-swatch";

export const LabelGroupRow = ({
  actionsDisabled,
  children,
  group,
  isExpanded,
  isSearching,
  onCreateGroup,
  onCreateLabel,
  onDelete,
  onEdit,
  onToggle,
}: {
  actionsDisabled: boolean;
  children: ReactNode[];
  group: LabelGroup;
  isExpanded: boolean;
  isSearching: boolean;
  onCreateGroup: () => void;
  onCreateLabel: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
}) => {
  let groupContent: ReactNode = null;
  if (isExpanded && children.length > 0) {
    groupContent = <ul className="ms-7 border-s border-border">{children}</ul>;
  } else if (isExpanded) {
    groupContent = (
      <p
        className={cn(
          "ms-7 border-s border-border text-body-sm text-muted-fg",
          settingsSurfaceVariants({ variant: "padding" })
        )}
      >
        No labels in this group.
      </p>
    );
  }

  return (
    <li>
      <div className={settingsSurfaceVariants({ variant: "insetRow" })}>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <IconButtonTooltip
            label={
              isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`
            }
          >
            <Button
              aria-expanded={isExpanded}
              aria-label={
                isExpanded ? `Collapse ${group.name}` : `Expand ${group.name}`
              }
              className="-ms-1"
              disabled={isSearching}
              onClick={onToggle}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <Icon
                aria-hidden
                icon={isExpanded ? ArrowDown01Icon : ArrowRight01Icon}
              />
            </Button>
          </IconButtonTooltip>
          <IconButtonTooltip label={`Edit color for ${group.name}`}>
            <Button
              aria-label={`Edit color for ${group.name}`}
              className="-mx-1.5"
              disabled={actionsDisabled}
              onClick={onEdit}
              size="icon-xs"
              type="button"
              variant="ghost"
            >
              <MailboxLabelSwatch color={group.color} kind="group" />
            </Button>
          </IconButtonTooltip>
          <Text as="span" className="min-w-0 flex-1" truncate>
            {group.name}
          </Text>
        </div>
        <DropdownMenu>
          <IconButtonTooltip label={`Options for ${group.name}`}>
            <DropdownMenuTrigger
              appearance="icon"
              aria-label={`Options for ${group.name}`}
              className="-me-2"
              disabled={actionsDisabled}
            >
              <Icon aria-hidden icon={MoreVerticalIcon} />
            </DropdownMenuTrigger>
          </IconButtonTooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onCreateLabel}>
              <Icon aria-hidden icon={Add01Icon} />
              New label here
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onCreateGroup}>
              <Icon aria-hidden icon={FolderAddIcon} />
              New group inside
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onEdit}>
              <Icon aria-hidden icon={Edit01Icon} />
              Edit group
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onDelete} tone="destructive">
              <Icon aria-hidden icon={Delete01Icon} />
              Delete group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {groupContent}
    </li>
  );
};
