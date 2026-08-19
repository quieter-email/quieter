"use client";

import { ArrowLeft01Icon, SidebarLeftIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import type { ReactNode } from "react";

const leadingIcons = {
  back: { icon: ArrowLeft01Icon, label: "Back to list" },
  sidebar: { icon: SidebarLeftIcon, label: "Open sidebar" },
} as const;

/**
 * The single narrow-viewport header for every product surface: Mail, message
 * detail, Compose, Chat, Templates, and Settings. One height, one icon size,
 * one border, one tooltip treatment. Pass `className` only for panel-edge bleed.
 */
export const MobileHeader = ({
  children,
  className,
  leading,
  onLeadingClick,
  title,
}: {
  children?: ReactNode;
  className?: string;
  leading: keyof typeof leadingIcons;
  onLeadingClick: () => void;
  title?: string;
}) => {
  const { icon, label } = leadingIcons[leading];

  return (
    <header
      className={cn(
        "flex min-h-12 shrink-0 items-center gap-2 border-b border-border px-2 lg:hidden",
        className
      )}
    >
      <IconButtonTooltip label={label}>
        <Button
          aria-label={label}
          onClick={onLeadingClick}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <HugeiconsIcon aria-hidden icon={icon} />
        </Button>
      </IconButtonTooltip>
      {title === undefined || title === "" ? null : (
        <p className="truncate text-body font-medium tracking-tight text-fg">
          {title}
        </p>
      )}
      {children === undefined ? null : (
        <div className="ml-auto flex items-center gap-1">{children}</div>
      )}
    </header>
  );
};
