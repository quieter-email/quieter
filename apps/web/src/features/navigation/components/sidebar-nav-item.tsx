"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { Button, type ButtonProps } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { useState } from "react";
import {
  SidebarActiveSurface,
  SidebarHoverSurface,
} from "~/features/navigation/components/sidebar-surfaces";
import { sidebarNavButtonClassName } from "~/features/navigation/domain/sidebar-surfaces";

type SidebarNavItemProps = Omit<ButtonProps, "onMouseEnter" | "onMouseLeave"> & {
  active?: boolean;
  activeSurfaceClassName?: string;
  children: ReactNode;
  hover?: boolean;
  hoverEnter?: boolean;
  hoverExiting?: boolean;
  hoverLayoutId?: string;
  hoverSurfaceClassName?: string;
  onHoverExitComplete?: () => void;
  onMouseEnter?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: MouseEventHandler<HTMLDivElement>;
};

export const SidebarNavItem = ({
  active,
  activeSurfaceClassName,
  children,
  className,
  hover,
  hoverEnter,
  hoverExiting,
  hoverLayoutId,
  hoverSurfaceClassName,
  onBlur,
  onFocus,
  onHoverExitComplete,
  onMouseEnter,
  onMouseLeave,
  variant = "ghost",
  ...buttonProps
}: SidebarNavItemProps) => {
  const [pressed, setPressed] = useState(false);

  return (
    <div
      className="relative w-full rounded-md py-px squircle"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerCancel={() => setPressed(false)}
      onPointerDown={(event) => {
        if (event.button === 0) {
          setPressed(true);
        }
      }}
      onPointerLeave={() => setPressed(false)}
      onPointerUp={() => setPressed(false)}
    >
      {active ? <SidebarActiveSurface className={activeSurfaceClassName} /> : null}
      {!active && (hover || hoverExiting) && hoverLayoutId ? (
        <SidebarHoverSurface
          className={hoverSurfaceClassName}
          hoverEnter={hoverEnter}
          hoverExiting={hoverExiting}
          hoverLayoutId={hoverLayoutId}
          onHoverExitComplete={onHoverExitComplete}
          pressed={pressed}
        />
      ) : null}
      <Button
        className={cn(sidebarNavButtonClassName, className)}
        onBlur={onBlur}
        onFocus={onFocus}
        variant={variant}
        {...buttonProps}
      >
        {children}
      </Button>
    </div>
  );
};
