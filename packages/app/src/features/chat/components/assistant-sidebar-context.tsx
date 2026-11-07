"use client";

import { LayoutRightIcon } from "@hugeicons/core-free-icons";
import { Button } from "@quieter/ui/button";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { WorkspaceHeaderActionSlot } from "@quieter/ui/workspace-section";
import { createContext, use } from "react";

export const AssistantSidebarContext = createContext<{
  onOpen: (trigger: HTMLButtonElement) => void;
  open: boolean;
  panelId: string;
} | null>(null);

export const AssistantSidebarTrigger = ({
  className,
  size = "icon",
  variant = "toolbar",
}: {
  className?: string;
  size?: "icon" | "icon-sm";
  variant?: "toolbar" | "ghost";
}) => {
  const sidebar = use(AssistantSidebarContext);
  if (!sidebar) {
    return null;
  }

  return (
    <WorkspaceHeaderActionSlot
      className={className}
      data-sidebar-open={sidebar.open}
      size={size}
      visible={!sidebar.open}
    >
      <IconButtonTooltip label="Expand assistant sidebar">
        <Button
          chrome="toolbar"
          aria-controls={sidebar.panelId}
          aria-expanded={sidebar.open}
          aria-label="Expand assistant sidebar"
          data-assistant-launcher
          onClick={(event) => {
            sidebar.onOpen(event.currentTarget);
          }}
          size={size}
          type="button"
          variant={variant}
        >
          <Icon aria-hidden icon={LayoutRightIcon} />
        </Button>
      </IconButtonTooltip>
    </WorkspaceHeaderActionSlot>
  );
};
