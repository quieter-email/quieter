"use client";

import { SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceHeader } from "@quieter/ui/workspace-section";
import type { ReactNode } from "react";

/**
 * Owns the message list header row: a sidebar slot plus search. Selection
 * actions float over the list instead, so this row never changes while
 * conversations are selected.
 */
export const MessageListHeader = ({
  onOpenSidebar,
  search,
}: {
  onOpenSidebar?: () => void;
  search: ReactNode;
}) => (
  <WorkspaceHeader className="relative z-20">
    <div className="flex min-w-0 items-stretch gap-2">
      {onOpenSidebar && (
        <div className="flex self-stretch lg:hidden">
          <IconButtonTooltip label="Open sidebar">
            <Button
              chrome="toolbar"
              aria-label="Open sidebar"
              onClick={onOpenSidebar}
              size="icon"
              variant="outline"
            >
              <Icon icon={SidebarLeftIcon} />
            </Button>
          </IconButtonTooltip>
        </div>
      )}

      <div className="min-w-0 flex-1">{search}</div>
    </div>
  </WorkspaceHeader>
);
