"use client";

import { cn } from "@quieter/ui/cn";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";

import { appEaseOut, appMotionDuration } from "#/features/motion/app-motion";

type GuidedFlowProps = {
  activeStep: string;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  direction: "back" | "forward";
  headerCenter?: ReactNode;
  headerEnd?: ReactNode;
  headerStart?: ReactNode;
  previous?: ReactNode;
};

export const GuidedFlow = ({
  activeStep,
  ariaLabel,
  children,
  className,
  direction,
  headerCenter,
  headerEnd,
  headerStart,
  previous,
}: GuidedFlowProps) => {
  const reducedMotion = useReducedMotion();
  const offset = direction === "forward" ? 18 : -18;
  const initial =
    reducedMotion === true
      ? { opacity: 0 }
      : {
          opacity: 0,
          transform: `translate3d(${offset}px, 0, 0)`,
        };
  const exit =
    reducedMotion === true
      ? { opacity: 0 }
      : {
          opacity: 0,
          transform: `translate3d(${-offset}px, 0, 0)`,
        };

  return (
    <section
      aria-label={ariaLabel}
      className={cn("flex min-h-full flex-col", className)}
    >
      <header className="sticky top-0 z-20 grid min-h-16 grid-cols-[1fr_auto_1fr] items-center border-b border-border/70 bg-bg-elevated/80 px-3 backdrop-blur-xl sm:px-5 lg:px-6">
        <div className="min-w-0 justify-self-start">{headerStart}</div>
        <div className="min-w-0 justify-self-center text-center">
          {headerCenter}
        </div>
        <div className="min-w-0 justify-self-end">{headerEnd}</div>
      </header>

      <div className="grid flex-1 lg:grid-cols-[minmax(11rem,1fr)_minmax(0,42rem)_minmax(11rem,1fr)]">
        <aside className="hidden items-center justify-end border-r border-border/60 px-6 lg:flex">
          {previous}
        </aside>

        <div className="relative flex min-h-[calc(100dvh-4rem)] min-w-0 items-center justify-center px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
          {previous === undefined || previous === null ? null : (
            <div className="absolute top-4 left-3 sm:left-5 lg:hidden">
              {previous}
            </div>
          )}
          <LazyMotion features={domAnimation}>
            <AnimatePresence initial={false} mode="popLayout">
              <m.div
                animate={{
                  opacity: 1,
                  transform: "translate3d(0, 0, 0)",
                }}
                className="w-full max-w-2xl"
                exit={exit}
                initial={initial}
                key={activeStep}
                transition={{
                  duration:
                    reducedMotion === true
                      ? appMotionDuration.feedback
                      : appMotionDuration.enter,
                  ease: appEaseOut,
                }}
              >
                {children}
              </m.div>
            </AnimatePresence>
          </LazyMotion>
        </div>

        <aside
          aria-hidden
          className="hidden border-l border-border/60 lg:block"
        />
      </div>
    </section>
  );
};
