"use client";

import { cn } from "@quieter/ui/cn";
import { AnimatePresence, m } from "motion/react";
import {
  sidebarActiveSurfaceClassName,
  sidebarHoverSurfaceClassName,
  sidebarHoverSurfaceItemClassName,
  sidebarSurfaceFadeTransition,
  sidebarSurfaceSpringTransition,
} from "~/features/navigation/domain/sidebar-surfaces";

type SidebarActiveSurfaceProps = {
  className?: string;
};

export const SidebarActiveSurface = ({ className }: SidebarActiveSurfaceProps) => (
  <span aria-hidden className={cn(sidebarActiveSurfaceClassName, className)} />
);

type SidebarHoverSurfaceProps = {
  className?: string;
  hoverEnter?: boolean;
  hoverExiting?: boolean;
  hoverLayoutId: string;
  onHoverExitComplete?: () => void;
  pressed: boolean;
};

export const SidebarHoverSurface = ({
  className,
  hoverEnter,
  hoverExiting,
  hoverLayoutId,
  onHoverExitComplete,
  pressed,
}: SidebarHoverSurfaceProps) => (
  <m.span
    className="pointer-events-none absolute inset-0 z-1"
    initial={false}
    layout={!hoverExiting ? "position" : false}
    layoutId={!hoverExiting ? hoverLayoutId : undefined}
    transition={sidebarSurfaceSpringTransition}
  >
    <m.span
      aria-hidden
      animate={
        hoverExiting ? { opacity: 0, scale: 0.95 } : { opacity: 1, scale: pressed ? 0.98 : 1 }
      }
      className={cn(sidebarHoverSurfaceItemClassName, className)}
      initial={hoverEnter ? { opacity: 0, scale: 0.95 } : false}
      onAnimationComplete={() => {
        if (hoverExiting) {
          onHoverExitComplete?.();
        }
      }}
      transition={{
        ...sidebarSurfaceFadeTransition,
        scale: hoverExiting
          ? sidebarSurfaceFadeTransition.scale
          : { duration: 0.1, ease: "easeOut" },
      }}
    />
  </m.span>
);

type SidebarSimpleHoverSurfaceProps = {
  className?: string;
  layoutId: string;
  visible: boolean;
};

export const SidebarSimpleHoverSurface = ({
  className,
  layoutId,
  visible,
}: SidebarSimpleHoverSurfaceProps) => (
  <AnimatePresence initial={false} mode="popLayout">
    {visible ? (
      <m.span
        aria-hidden
        animate={{ opacity: 1, scale: 1 }}
        className={cn(
          "pointer-events-none absolute inset-0 z-0",
          sidebarHoverSurfaceClassName,
          className,
        )}
        exit={{ opacity: 0, scale: 0.95 }}
        initial={{ opacity: 0, scale: 0.95 }}
        layoutId={layoutId}
        transition={{
          ...sidebarSurfaceSpringTransition,
          ...sidebarSurfaceFadeTransition,
        }}
      />
    ) : null}
  </AnimatePresence>
);
