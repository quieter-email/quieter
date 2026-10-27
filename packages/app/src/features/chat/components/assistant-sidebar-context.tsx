"use client";

import { LayoutRightIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { createContext, use } from "react";

export const AssistantSidebarContext = createContext<{
  onOpen: (trigger: HTMLButtonElement) => void;
  open: boolean;
  panelId: string;
  showNavigationTrigger: boolean;
} | null>(null);

export const AssistantSidebarTrigger = ({
  className,
}: {
  className?: string;
}) => {
  const sidebar = use(AssistantSidebarContext);
  if (!sidebar) {
    return null;
  }

  return (
    <div
      aria-hidden={sidebar.open}
      className={cn(
        "flex shrink-0 self-stretch overflow-hidden transition-opacity duration-200 ease-out motion-reduce:transition-none",
        {
          "pointer-events-none w-0 opacity-0": sidebar.open,
          "w-8 opacity-100": !sidebar.open,
        },
        className
      )}
      data-sidebar-open={sidebar.open}
      inert={sidebar.open}
    >
      <IconButtonTooltip label="Expand assistant sidebar">
        <Button
          aria-controls={sidebar.panelId}
          aria-expanded={sidebar.open}
          aria-label="Expand assistant sidebar"
          data-assistant-launcher
          onClick={(event) => {
            sidebar.onOpen(event.currentTarget);
          }}
          size="icon"
          type="button"
          variant="toolbar"
        >
          <Icon aria-hidden icon={LayoutRightIcon} />
        </Button>
      </IconButtonTooltip>
    </div>
  );
};
