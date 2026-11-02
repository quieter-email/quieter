"use client";

import {
  domAnimation,
  LazyMotion,
  m,
  PresenceContext,
  useReducedMotion,
} from "motion/react";
import type { PropsWithChildren } from "react";

export const SuccessPulse = ({
  active,
  children,
  onComplete,
}: PropsWithChildren<{
  active: boolean;
  onComplete: () => void;
}>) => {
  const reducedMotion = useReducedMotion() === true;
  const animation = reducedMotion
    ? { opacity: [1, 1] }
    : {
        opacity: [0.6, 1, 1, 0],
        rotate: [0, -8, 6, 0],
        scale: [1, 1.18, 1],
      };
  return (
    <LazyMotion features={domAnimation}>
      <PresenceContext.Provider value={null}>
        <m.span
          animate={active ? animation : { opacity: 1 }}
          className="inline-flex items-center justify-center"
          initial={false}
          onAnimationComplete={() => {
            if (active) {
              onComplete();
            }
          }}
          transition={{
            duration: reducedMotion ? 0 : 0.45,
            ease: [0.23, 1, 0.32, 1],
          }}
        >
          {children}
        </m.span>
      </PresenceContext.Provider>
    </LazyMotion>
  );
};
