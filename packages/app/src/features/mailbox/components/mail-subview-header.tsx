"use client";

import { Cancel01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { AssistantSidebarTrigger } from "@quieter/app/features/chat/components/assistant-sidebar-context";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { Text } from "@quieter/ui/text";
import type { ReactNode } from "react";

export const MailSubviewHeader = ({
  children,
  className,
  closeAction,
  onOpenSidebar,
  title,
}: {
  children?: ReactNode;
  className?: string;
  closeAction?: {
    disabled?: boolean;
    label: string;
    onClick: () => void;
  };
  onOpenSidebar?: () => void;
  title: string;
}) => {
  const handleClose = closeAction?.onClick;
  return (
    <div className={cn("flex shrink-0 items-center gap-2", className)}>
      {closeAction ? (
        <IconButtonTooltip label={closeAction.label}>
          <Button
            aria-label={closeAction.label}
            disabled={closeAction.disabled}
            onClick={handleClose}
            size="icon"
            type="button"
            variant="toolbar"
          >
            <Icon aria-hidden icon={Cancel01Icon} />
          </Button>
        </IconButtonTooltip>
      ) : null}
      {onOpenSidebar ? (
        <IconButtonTooltip label="Open sidebar">
          <Button
            aria-label="Open sidebar"
            className="lg:hidden"
            onClick={onOpenSidebar}
            size="icon"
            type="button"
            variant="toolbar"
          >
            <Icon aria-hidden icon={SidebarLeftIcon} />
          </Button>
        </IconButtonTooltip>
      ) : null}
      <Text
        as="h1"
        className="min-w-0 flex-1"
        size="lg"
        truncate
        weight="medium"
      >
        {title}
      </Text>
      {children}
      <AssistantSidebarTrigger />
    </div>
  );
};
