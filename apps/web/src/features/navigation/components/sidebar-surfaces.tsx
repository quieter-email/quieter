"use client";

import { cn } from "@quieter/ui/cn";
import { cva } from "class-variance-authority";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { appMotionDuration } from "#/features/motion/app-motion";

const sidebarSurfaceSpringTransition = {
  layout: { damping: 38, mass: 0.55, stiffness: 560, type: "spring" as const },
};

const sidebarSurfaceFadeTransition = {
  opacity: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const },
  transform: { duration: 0.18, ease: [0.23, 1, 0.32, 1] as const },
};

export const sidebarSurfaceVariants = cva("squircle rounded-md", {
  variants: {
    surface: {
      active: "pointer-events-none absolute inset-0 z-0 bg-control-active/25",
      hover: "bg-muted",
      hoverItem: "block size-full bg-muted",
    },
  },
});

export const sidebarNavButtonVariants = cva(
  "relative z-10 w-full bg-transparent hover:bg-transparent active:scale-100 active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:hover:bg-transparent aria-[current=page]:active:bg-transparent motion-reduce:active:scale-100"
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
  // react-doctor-disable-next-line react-hooks-js/refs -- Entrance animation is intentionally captured only on mount.
  const shouldAnimate = useRef(animateEntrance).current;
  const [isAnimating, setIsAnimating] = useState(animateEntrance);
  let initial:
    | false
    | {
        filter?: string;
        opacity: number;
        transform?: string;
      } = false;
  if (shouldAnimate) {
    initial =
      reducedMotion === true
        ? { opacity: 0 }
        : {
            filter: "blur(8px)",
            opacity: 0,
            transform: "translate3d(-20px, 0, 0)",
          };
  }

  return (
    <m.div
      animate={{
        filter: "blur(0px)",
        opacity: 1,
        transform: "translate3d(0, 0, 0)",
      }}
      className={cn(
        { "will-change-[transform,opacity,filter]": isAnimating },
        className
      )}
      initial={initial}
      onAnimationComplete={() => {
        setIsAnimating(false);
      }}
      transition={{
        delay: shouldAnimate && reducedMotion !== true ? index * 0.075 : 0,
        duration: reducedMotion === true ? appMotionDuration.feedback : 0.5,
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

export const SidebarActiveSurface = ({
  className,
}: SidebarActiveSurfaceProps) => (
  <span
    aria-hidden
    className={cn(sidebarSurfaceVariants({ surface: "active" }), className)}
  />
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
  let hoverTransform = "scale(1)";
  if (reducedMotion !== true && pressed) {
    hoverTransform = "scale(0.98)";
  }
  const hoverScale = reducedMotion === true ? "scale(1)" : "scale(0.98)";
  let hoverInitial: false | { opacity: number; transform: string } = false;
  if (hoverEnter === true) {
    hoverInitial = { opacity: 0, transform: hoverScale };
  }

  return (
    <m.span
      className="pointer-events-none absolute inset-0 z-1"
      initial={false}
      layout={
        reducedMotion !== true && hoverExiting !== true ? "position" : false
      }
      layoutId={
        reducedMotion !== true && hoverExiting !== true
          ? hoverLayoutId
          : undefined
      }
      transition={sidebarSurfaceSpringTransition}
    >
      <m.span
        aria-hidden
        animate={
          hoverExiting === true
            ? { opacity: 0, transform: hoverScale }
            : { opacity: 1, transform: hoverTransform }
        }
        className={cn(
          sidebarSurfaceVariants({ surface: "hoverItem" }),
          className
        )}
        initial={hoverInitial}
        onAnimationComplete={() => {
          if (hoverExiting === true) {
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
            className
          )}
          exit={{
            opacity: 0,
            transform: reducedMotion === true ? "scale(1)" : "scale(0.98)",
          }}
          initial={{
            opacity: 0,
            transform: reducedMotion === true ? "scale(1)" : "scale(0.98)",
          }}
          layoutId={reducedMotion === true ? undefined : layoutId}
          transition={{
            ...sidebarSurfaceSpringTransition,
            ...sidebarSurfaceFadeTransition,
          }}
        />
      ) : null}
    </AnimatePresence>
  );
};
