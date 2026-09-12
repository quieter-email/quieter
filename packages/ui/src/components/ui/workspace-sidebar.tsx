"use client";

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { domMax, LazyMotion } from "motion/react";
import { useEffect, useEffectEvent } from "react";
import type { ReactNode } from "react";

type WorkspaceSidebarProps = {
  children: (close?: () => void) => ReactNode;
  isMobileOpen: boolean;
  onMobileOpenChange: (open: boolean) => void;
  label: string;
};

export const WorkspaceSidebar = ({
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
        className="relative hidden h-full shrink-0 bg-transparent text-fg lg:flex lg:flex-col"
        style={{ width: "272px" }}
      >
        {children()}
      </aside>
      <DialogPrimitive.Root
        modal
        open={isMobileOpen}
        onOpenChange={onMobileOpenChange}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-40 bg-bg/50 backdrop-blur-[2px] transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none" />
          <DialogPrimitive.Popup
            aria-label={label}
            initialFocus
            finalFocus
            className="fixed inset-y-0 left-0 isolate z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl transition-transform duration-200 ease-out outline-none data-ending-style:-translate-x-full data-starting-style:-translate-x-full motion-reduce:transition-none"
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
