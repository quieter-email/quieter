"use client";

import { LayoutRightIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { createContext, use } from "react";

export const AssistantSidebarContext = createContext<{
  onOpen: (trigger: HTMLButtonElement) => void;
  open: boolean;
  panelId: string;
  showNavigationTrigger: boolean;
} | null>(null);

export const AssistantSidebarTrigger = () => {
  const sidebar = use(AssistantSidebarContext);
  if (!sidebar || sidebar.open) {
    return null;
  }

  return (
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
        <HugeiconsIcon aria-hidden icon={LayoutRightIcon} />
      </Button>
    </IconButtonTooltip>
  );
};
