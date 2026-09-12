"use client";

import {
  AnimatePresence,
  domMax,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
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
  const reducedMotion = useReducedMotion();
  const closeMobileSidebar = useEffectEvent(() => {
    onMobileOpenChange(false);
  });
  useEffect((): (() => void) | undefined => {
    if (!isMobileOpen) {
      return undefined;
    }

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMobileSidebar();
      }
    };

    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
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
      <AnimatePresence initial={false}>
        {isMobileOpen && (
          <>
            <m.button
              aria-label="Close sidebar"
              className="fixed inset-0 z-40 bg-bg/50 backdrop-blur-[2px] lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                onMobileOpenChange(false);
              }}
              type="button"
            />
            <m.aside
              aria-label={label}
              className="fixed inset-y-0 left-0 isolate z-50 flex w-[min(20rem,calc(100vw-2.5rem))] flex-col overflow-hidden bg-bg pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-fg shadow-2xl lg:hidden"
              initial={
                reducedMotion === true
                  ? { opacity: 0, transform: "translate3d(0, 0, 0)" }
                  : { opacity: 1, transform: "translate3d(-100%, 0, 0)" }
              }
              animate={{ opacity: 1, transform: "translate3d(0, 0, 0)" }}
              exit={
                reducedMotion === true
                  ? { opacity: 0, transform: "translate3d(0, 0, 0)" }
                  : { opacity: 1, transform: "translate3d(-100%, 0, 0)" }
              }
              transition={
                reducedMotion === true
                  ? { duration: 0.1 }
                  : { bounce: 0, duration: 0.24, type: "spring" }
              }
            >
              {children(() => {
                onMobileOpenChange(false);
              })}
            </m.aside>
          </>
        )}
      </AnimatePresence>
    </LazyMotion>
  );
};
