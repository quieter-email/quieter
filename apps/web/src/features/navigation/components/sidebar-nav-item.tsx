"use client";

import type { ReactNode } from "react";
import { Button, cn, type ButtonProps } from "@quieter/ui";
import { m } from "motion/react";

type SidebarNavItemProps = ButtonProps & {
  active?: boolean;
  activeLayoutId?: string;
  activeSurfaceClassName?: string;
  children: ReactNode;
  hover?: boolean;
  hoverEnter?: boolean;
  hoverExiting?: boolean;
  hoverLayoutId?: string;
  hoverSurfaceClassName?: string;
  onHoverExitComplete?: () => void;
};

export const SidebarNavItem = ({
  active,
  activeLayoutId,
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
  const showHoverSurface = (hover || hoverExiting) && hoverLayoutId;

  return (
    <div
      className="relative w-full rounded-md py-px"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {active ? (
        activeLayoutId ? (
          <m.span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 z-0 rounded-md bg-muted",
              activeSurfaceClassName,
            )}
            initial={false}
            layout="position"
            layoutId={activeLayoutId}
            transition={{
              layout: { type: "spring", stiffness: 1200, damping: 52, mass: 0.3 },
            }}
          />
        ) : (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 z-0 rounded-md bg-muted",
              activeSurfaceClassName,
            )}
          />
        )
      ) : null}
      {showHoverSurface ? (
        <m.span
          className="pointer-events-none absolute inset-0 z-1"
          initial={false}
          layout={hover ? "position" : false}
          layoutId={hover ? hoverLayoutId : undefined}
          transition={{
            layout: { type: "spring", stiffness: 1200, damping: 52, mass: 0.3 },
          }}
        >
          <m.span
            aria-hidden
            animate={hoverExiting ? { opacity: 0, scale: 0.9 } : { opacity: 1, scale: 1 }}
            className={cn("block size-full rounded-md bg-muted/60", hoverSurfaceClassName)}
            initial={hoverEnter ? { opacity: 0, scale: 0.9 } : false}
            onAnimationComplete={() => {
              if (hoverExiting) {
                onHoverExitComplete?.();
              }
            }}
            transition={{
              opacity: { duration: 0.08, ease: "easeOut" },
              scale: { duration: 0.08, ease: "easeOut" },
            }}
          />
        </m.span>
      ) : null}
      <Button
        className={cn(
          "relative z-10 w-full bg-transparent hover:bg-transparent active:scale-100 active:bg-transparent",
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
