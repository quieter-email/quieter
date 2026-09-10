"use client";

import { Button } from "@quieter/ui/button";
import type { ButtonProps } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import type { MouseEventHandler, ReactNode } from "react";

import {
  SidebarActiveSurface,
  sidebarNavButtonVariants,
} from "#/features/navigation/components/sidebar-surfaces";

type SidebarNavItemProps = Omit<
  ButtonProps,
  "onMouseEnter" | "onMouseLeave"
> & {
  active?: boolean;
  activeSurfaceClassName?: string;
  children: ReactNode;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
  trailing?: ReactNode;
};

export const SidebarNavItem = ({
  active,
  activeSurfaceClassName,
  children,
  className,
  onBlur,
  onFocus,
  onMouseEnter,
  onMouseLeave,
  trailing,
  variant = "ghost",
  ...buttonProps
}: SidebarNavItemProps) => (
  <div
    className={cn(
      "group squircle relative flex w-full items-center rounded-md py-px",
      {
        "hover:bg-muted/60 dark:hover:bg-muted/40": active !== true,
      }
    )}
    onMouseEnter={onMouseEnter}
    onMouseLeave={onMouseLeave}
  >
    {active === true ? (
      <SidebarActiveSurface className={activeSurfaceClassName} />
    ) : null}
    <Button
      className={cn(sidebarNavButtonVariants(), className)}
      onBlur={onBlur}
      onFocus={onFocus}
      variant={variant}
      {...buttonProps}
    >
      {children}
    </Button>
    {trailing}
  </div>
);
