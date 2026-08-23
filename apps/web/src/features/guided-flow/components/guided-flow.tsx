"use client";

import { cn } from "@quieter/ui/cn";
import type { Variants } from "motion/react";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import type { ReactNode } from "react";

import {
  appEaseInOut,
  appEaseOut,
  appMotionDuration,
} from "#/features/motion/app-motion";

type GuidedFlowProps = {
  activeStep: string;
  ariaLabel: string;
  /** Sits behind the middle row only, so the header and closing band stay flat. */
  backdrop?: ReactNode;
  children: ReactNode;
  className?: string;
  direction: "back" | "forward";
  headerEnd?: ReactNode;
  headerStart?: ReactNode;
  previous?: ReactNode;
};

export const GuidedFlow = ({
  activeStep,
  ariaLabel,
  backdrop,
  children,
  className,
  direction,
  headerEnd,
  headerStart,
  previous,
}: GuidedFlowProps) => {
  const reducedMotion = useReducedMotion();
  const isReduced = reducedMotion === true;
  const isForward = direction === "forward";
  const stepVariants: Variants = {
    center: { opacity: 1, x: 0 },
    enter: isReduced
      ? { opacity: 0, x: 0 }
      : { opacity: 1, x: isForward ? "110%" : "-110%" },
    exit: (isForwardExit: boolean) =>
      isReduced
        ? { opacity: 0, x: 0 }
        : { opacity: 1, x: isForwardExit ? "-110%" : "110%" },
  };

  return (
    <section
      aria-label={ariaLabel}
      className={cn("flex min-h-full flex-col", className)}
    >
      <header className="sticky top-0 z-20 grid min-h-16 grid-cols-[1fr_auto_1fr] border-b border-border/70 bg-bg lg:grid-cols-[minmax(11rem,1fr)_minmax(0,42rem)_minmax(11rem,1fr)]">
        <div className="flex min-w-0 items-center px-3 sm:px-5 lg:border-r lg:border-border/60 lg:px-6">
          {headerStart}
        </div>
        <div className="col-start-3 flex min-w-0 items-center justify-end px-3 sm:px-5 lg:border-l lg:border-border/60 lg:px-6">
          {headerEnd}
        </div>
      </header>

      <div className="relative isolate grid flex-1 lg:grid-cols-[minmax(11rem,1fr)_minmax(0,42rem)_minmax(11rem,1fr)]">
        {backdrop}
        <aside className="hidden items-center justify-end border-r border-border/60 px-6 lg:flex">
          {previous}
        </aside>

        <div className="relative flex min-h-[calc(100dvh-8rem)] min-w-0 items-center justify-center overflow-hidden bg-bg px-5 py-10 sm:px-8 sm:py-12 lg:px-12">
          {previous === undefined || previous === null ? null : (
            <div className="absolute top-4 left-3 sm:left-5 lg:hidden">
              {previous}
            </div>
          )}
          <LazyMotion features={domAnimation}>
            <AnimatePresence
              custom={isForward}
              initial={false}
              mode="popLayout"
            >
              <m.div
                animate="center"
                className="w-full max-w-2xl"
                exit="exit"
                initial="enter"
                key={activeStep}
                transition={{
                  duration: isReduced
                    ? appMotionDuration.feedback
                    : appMotionDuration.layout,
                  ease: isReduced ? appEaseOut : appEaseInOut,
                }}
                variants={stepVariants}
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

      <div className="grid min-h-16 border-t border-border/70 bg-bg lg:grid-cols-[minmax(11rem,1fr)_minmax(0,42rem)_minmax(11rem,1fr)]">
        <div
          aria-hidden
          className="hidden border-r border-border/60 lg:block"
        />
        <div aria-hidden className="hidden lg:block" />
        <div
          aria-hidden
          className="hidden border-l border-border/60 lg:block"
        />
      </div>
    </section>
  );
};
