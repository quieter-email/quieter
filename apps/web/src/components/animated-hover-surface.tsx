"use client";

import { cn } from "@quieter/ui";
import { AnimatePresence, m } from "motion/react";

type AnimatedHoverSurfaceProps = {
  className?: string;
  layoutId: string;
  visible: boolean;
};

export const AnimatedHoverSurface = ({
  className,
  layoutId,
  visible,
}: AnimatedHoverSurfaceProps) => (
  <AnimatePresence initial={false} mode="popLayout">
    {visible ? (
      <m.span
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 z-0 rounded-md bg-muted/60", className)}
        layoutId={layoutId}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{
          layout: { type: "spring", stiffness: 1200, damping: 52, mass: 0.3 },
          opacity: { duration: 0.08, ease: "easeOut" },
          scale: { duration: 0.08, ease: "easeOut" },
        }}
      />
    ) : null}
  </AnimatePresence>
);
