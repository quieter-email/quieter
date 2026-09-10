"use client";

import { cn } from "@quieter/ui/cn";
import { cva } from "class-variance-authority";
import { m, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";
import type { ReactNode } from "react";

import { appMotionDuration } from "#/features/motion/app-motion";

const sidebarSurfaceVariants = cva("squircle rounded-md", {
  variants: {
    surface: {
      active: "pointer-events-none absolute inset-0 z-0 bg-control-active",
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
