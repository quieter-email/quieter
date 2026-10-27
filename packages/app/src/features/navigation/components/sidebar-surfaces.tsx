"use client";

import { getAppStaggerDelay } from "@quieter/app/features/motion/app-motion";
import { cn } from "@quieter/ui/cn";
import { workspaceSidebarEntranceClassName } from "@quieter/ui/workspace-sidebar";
import { cva } from "class-variance-authority";
import type { ReactNode } from "react";

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
}: SidebarEntranceProps) => (
  <div
    className={cn(className, {
      [workspaceSidebarEntranceClassName]: animateEntrance,
    })}
    style={
      animateEntrance
        ? {
            // oxlint-disable-next-line shadcn/no-inline-styles -- The app owns the bounded entrance sequence.
            transitionDelay: `${getAppStaggerDelay(index)}s`,
          }
        : undefined
    }
  >
    {children}
  </div>
);

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
