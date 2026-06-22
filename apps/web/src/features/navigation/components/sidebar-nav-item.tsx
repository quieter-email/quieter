"use client";

import type { MouseEventHandler, ReactNode } from "react";
import { Button, cn, type ButtonProps } from "@quieter/ui";
import { m } from "motion/react";
import { useState } from "react";

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

const HoverSurface = ({
  hoverEnter,
  hoverExiting,
  hoverLayoutId,
  hoverSurfaceClassName,
  onHoverExitComplete,
  pressed,
}: {
  hoverEnter?: boolean;
  hoverExiting?: boolean;
  hoverLayoutId: string;
  hoverSurfaceClassName?: string;
  onHoverExitComplete?: () => void;
  pressed: boolean;
}) => (
  <m.span
    className="pointer-events-none absolute inset-0 z-1"
    initial={false}
    layout={!hoverExiting ? "position" : false}
    layoutId={!hoverExiting ? hoverLayoutId : undefined}
    transition={{
      layout: { type: "spring", stiffness: 1200, damping: 52, mass: 0.3 },
    }}
  >
    <m.span
      aria-hidden
      animate={
        hoverExiting ? { opacity: 0, scale: 0.9 } : { opacity: 1, scale: pressed ? 0.95 : 1 }
      }
      className={cn("block size-full rounded-md bg-muted/60", hoverSurfaceClassName)}
      initial={hoverEnter ? { opacity: 0, scale: 0.9 } : false}
      onAnimationComplete={() => {
        if (hoverExiting) {
          onHoverExitComplete?.();
        }
      }}
      transition={{
        opacity: { duration: 0.08, ease: "easeOut" },
        scale: hoverExiting
          ? { duration: 0.08, ease: "easeOut" }
          : { duration: 0.1, ease: "easeOut" },
      }}
    />
  </m.span>
);

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
      className="relative w-full rounded-md py-px"
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
      {active ? (
        <m.span
          aria-hidden
          animate={{ scale: pressed ? 0.95 : 1 }}
          className={cn(
            "pointer-events-none absolute inset-0 z-0 rounded-md bg-muted",
            activeSurfaceClassName,
          )}
          initial={false}
          transition={{ scale: { duration: 0.1, ease: "easeOut" } }}
        />
      ) : null}
      {!active && (hover || hoverExiting) && hoverLayoutId ? (
        <HoverSurface
          hoverEnter={hoverEnter}
          hoverExiting={hoverExiting}
          hoverLayoutId={hoverLayoutId}
          hoverSurfaceClassName={hoverSurfaceClassName}
          onHoverExitComplete={onHoverExitComplete}
          pressed={pressed}
        />
      ) : null}
      <Button
        className={cn(
          "relative z-10 w-full bg-transparent hover:bg-transparent active:scale-100 active:bg-transparent motion-reduce:active:scale-100",
          className,
        )}
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
