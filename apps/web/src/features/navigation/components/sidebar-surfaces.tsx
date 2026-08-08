"use client";

import { cn } from "@quieter/ui/cn";
import { cva } from "class-variance-authority";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { type ReactNode, useState } from "react";
import { appMotionDuration } from "~/features/motion/app-motion";

const sidebarSurfaceSpringTransition = {
  layout: { type: "spring" as const, stiffness: 560, damping: 38, mass: 0.55 },
};

const sidebarSurfaceFadeTransition = {
  opacity: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const },
  transform: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const },
};

export const sidebarSurfaceVariants = cva("squircle rounded-md", {
  variants: {
    surface: {
      active: "pointer-events-none absolute inset-0 z-0 bg-bg",
      hover: "bg-bg/50",
      hoverItem: "block size-full bg-bg/50",
    },
  },
});

export const sidebarNavButtonVariants = cva(
  "relative z-10 w-full bg-transparent hover:bg-transparent active:scale-100 active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:hover:bg-transparent aria-[current=page]:active:bg-transparent motion-reduce:active:scale-100",
);

type SidebarEntranceProps = {
  animateEntrance: boolean;
  children: ReactNode;
  className?: string;
  index?: number;
};

export const SidebarEntrance = ({
  animateEntrance,
  children,
  className,
  index = 0,
}: SidebarEntranceProps) => {
  const reducedMotion = useReducedMotion();
  const [shouldAnimate] = useState(animateEntrance);
  const [isAnimating, setIsAnimating] = useState(animateEntrance);

  return (
    <m.div
      animate={{ filter: "blur(0px)", opacity: 1, transform: "translate3d(0, 0, 0)" }}
      className={cn({ "will-change-[transform,opacity,filter]": isAnimating }, className)}
      initial={
        shouldAnimate
          ? reducedMotion
            ? { opacity: 0 }
            : {
                filter: "blur(8px)",
                opacity: 0,
                transform: "translate3d(-20px, 0, 0)",
              }
          : false
      }
      onAnimationComplete={() => setIsAnimating(false)}
      transition={{
        delay: shouldAnimate && !reducedMotion ? index * 0.075 : 0,
        duration: reducedMotion ? appMotionDuration.feedback : 0.5,
        ease: "easeOut",
      }}
    >
      {children}
    </m.div>
  );
};

type SidebarActiveSurfaceProps = {
  className?: string;
};

export const SidebarActiveSurface = ({ className }: SidebarActiveSurfaceProps) => (
  <span aria-hidden className={cn(sidebarSurfaceVariants({ surface: "active" }), className)} />
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
}: SidebarHoverSurfaceProps) => {
  const reducedMotion = useReducedMotion();

  return (
    <m.span
      className="pointer-events-none absolute inset-0 z-1"
      initial={false}
      layout={!reducedMotion && !hoverExiting ? "position" : false}
      layoutId={!reducedMotion && !hoverExiting ? hoverLayoutId : undefined}
      transition={sidebarSurfaceSpringTransition}
    >
      <m.span
        aria-hidden
        animate={
          hoverExiting
            ? {
                opacity: 0,
                transform: reducedMotion ? "scale(1)" : "scale(0.98)",
              }
            : {
                opacity: 1,
                transform: reducedMotion ? "scale(1)" : pressed ? "scale(0.98)" : "scale(1)",
              }
        }
        className={cn(sidebarSurfaceVariants({ surface: "hoverItem" }), className)}
        initial={
          hoverEnter
            ? {
                opacity: 0,
                transform: reducedMotion ? "scale(1)" : "scale(0.98)",
              }
            : false
        }
        onAnimationComplete={() => {
          if (hoverExiting) {
            onHoverExitComplete?.();
          }
        }}
        transition={{
          ...sidebarSurfaceFadeTransition,
          transform: sidebarSurfaceFadeTransition.transform,
        }}
      />
    </m.span>
  );
};

type SidebarSimpleHoverSurfaceProps = {
  className?: string;
  layoutId: string;
  visible: boolean;
};

export const SidebarSimpleHoverSurface = ({
  className,
  layoutId,
  visible,
}: SidebarSimpleHoverSurfaceProps) => {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false} mode="popLayout">
      {visible ? (
        <m.span
          aria-hidden
          animate={{ opacity: 1, transform: "scale(1)" }}
          className={cn(
            "pointer-events-none absolute inset-0 z-0",
            sidebarSurfaceVariants({ surface: "hover" }),
            className,
          )}
          exit={{
            opacity: 0,
            transform: reducedMotion ? "scale(1)" : "scale(0.98)",
          }}
          initial={{
            opacity: 0,
            transform: reducedMotion ? "scale(1)" : "scale(0.98)",
          }}
          layoutId={reducedMotion ? undefined : layoutId}
          transition={{
            ...sidebarSurfaceSpringTransition,
            ...sidebarSurfaceFadeTransition,
          }}
        />
      ) : null}
    </AnimatePresence>
  );
};
