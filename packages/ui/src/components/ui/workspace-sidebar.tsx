"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@quieter/ui/cn";
import { domMax, LazyMotion } from "motion/react";
import { useEffect, useEffectEvent } from "react";
import type { ReactNode } from "react";

import { entranceMotionVariants } from "./motion";

export const workspaceSidebarEntranceClassName = cn(
  entranceMotionVariants({ effect: "fade" }),
  "duration-500 ease-linear motion-reduce:delay-0! motion-reduce:duration-150"
);

type WorkspaceSidebarProps = {
  animateEntrance?: boolean;
  children: (close?: () => void) => ReactNode;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  label: string;
};

export const WorkspaceSidebar = ({
  animateEntrance = false,
  children,
  isMobileOpen,
  onMobileOpenChange,
  label,
}: WorkspaceSidebarProps) => {
  const closeMobileSidebar = useEffectEvent(() => {
    onMobileOpenChange(false);
  });
  useEffect((): (() => void) | undefined => {
    if (!isMobileOpen) {
      return undefined;
    }
    const desktop = window.matchMedia("(min-width: 64rem)");
    const closeOnDesktop = () => {
      if (desktop.matches) {
        closeMobileSidebar();
      }
    };
    closeOnDesktop();
    desktop.addEventListener("change", closeOnDesktop);
    return () => {
      desktop.removeEventListener("change", closeOnDesktop);
    };
  }, [isMobileOpen]);

  return (
    <LazyMotion features={domMax}>
      <aside
        className={cn(
          "relative hidden h-full w-64 shrink-0 bg-transparent text-fg lg:flex lg:flex-col",
          {
            "origin-left transition-[scale] duration-500 ease-(--app-motion-ease-out) motion-safe:starting:scale-[0.97]":
              animateEntrance,
          }
        )}
      >
        {children()}
      </aside>
      <DialogPrimitive.Root
        modal
        open={isMobileOpen}
        onOpenChange={onMobileOpenChange}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <DialogPrimitive.Popup
            aria-label={label}
            initialFocus
            finalFocus
            className="fixed inset-y-0 left-0 isolate z-50 flex w-[min(20rem,calc(100vw-2.5rem))] origin-left flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl transition-[opacity,scale,translate] duration-250 ease-(--app-motion-ease-out) outline-none data-ending-style:opacity-0 data-ending-style:duration-200 data-starting-style:opacity-0 motion-safe:data-ending-style:-translate-x-full motion-safe:data-ending-style:scale-[0.97] motion-safe:data-starting-style:-translate-x-full motion-safe:data-starting-style:scale-[0.97] motion-reduce:transition-opacity"
          >
            {children(() => {
              onMobileOpenChange(false);
            })}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </LazyMotion>
  );
};
