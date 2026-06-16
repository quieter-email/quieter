"use client";

import { cn } from "@quieter/ui";
import { m } from "motion/react";

type AnimatedHoverSurfaceProps = {
  className?: string;
  layoutId: string;
  visible: boolean;
};

export const AnimatedHoverSurface = ({ className, layoutId, visible }: AnimatedHoverSurfaceProps) =>
  visible ? (
    <m.span
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-md bg-muted/60", className)}
      layoutId={layoutId}
      transition={{ type: "spring", stiffness: 640, damping: 44, mass: 0.55 }}
    />
  ) : null;
