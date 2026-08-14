"use client";

import { Button } from "@quieter/ui/button";
import type { ButtonProps } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import type { MouseEventHandler, ReactNode } from "react";
import { useState } from "react";

import {
  SidebarActiveSurface,
  SidebarHoverSurface,
  sidebarNavButtonVariants,
} from "#/features/navigation/components/sidebar-surfaces";

type SidebarNavItemProps = Omit<
  ButtonProps,
  "onMouseEnter" | "onMouseLeave"
> & {
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
  trailing?: ReactNode;
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
  trailing,
  variant = "ghost",
  ...buttonProps
}: SidebarNavItemProps) => {
  const [pressed, setPressed] = useState(false);

  return (
    <div
      className="group squircle relative flex w-full items-center rounded-md py-px"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onPointerCancel={() => {
        setPressed(false);
      }}
      onPointerDown={(event) => {
        if (event.button === 0) {
          setPressed(true);
        }
      }}
      onPointerLeave={() => {
        setPressed(false);
      }}
      onPointerUp={() => {
        setPressed(false);
      }}
    >
      {active === true ? (
        <SidebarActiveSurface className={activeSurfaceClassName} />
      ) : null}
      {active !== true &&
      (hover === true || hoverExiting === true) &&
      hoverLayoutId !== undefined &&
      hoverLayoutId !== "" ? (
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
};
