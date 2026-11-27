"use client";

import { Search01Icon } from "@hugeicons/core-free-icons";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Icon } from "./icon";
import {
  menuGroupLabelClassName,
  menuItemClassName,
  menuListPaddingClassName,
  menuSurfaceClassName,
} from "./menu-chrome";

export const PopupMenuSurface = ({
  className,
  ...props
}: ComponentProps<"div">) => (
  <div
    className={cn(menuSurfaceClassName, menuListPaddingClassName, className)}
    {...props}
  />
);

export const PopupMenuGroupLabel = (props: ComponentProps<"div">) => (
  <div {...props} className={cn(menuGroupLabelClassName, props.className)} />
);

export const PopupMenuSearch = ({
  children,
  icon = Search01Icon,
}: {
  children: ReactNode;
  icon?: ComponentProps<typeof Icon>["icon"];
}) => (
  <div className="flex shrink-0 items-center gap-2 border-b border-fg/10 px-3.5">
    <Icon aria-hidden icon={icon} tone="muted" />
    {children}
  </div>
);

export const PopupMenuButton = ({
  className,
  highlighted = false,
  ...props
}: Omit<ComponentProps<"button">, "type"> & { highlighted?: boolean }) => (
  <button
    className={cn(
      menuItemClassName,
      "w-full enabled:hover:bg-popover-highlight disabled:opacity-50 aria-pressed:not-data-highlighted:not-hover:bg-popover-highlight/60",
      className
    )}
    data-highlighted={highlighted ? "" : undefined}
    type="button"
    {...props}
  />
);
