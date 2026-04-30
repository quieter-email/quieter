"use client";

import type { PropsWithChildren } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useState } from "react";
type SpinWhileActiveProps = PropsWithChildren<{
  active: boolean;
}>;

export const SpinWhileActive = ({ active, children }: SpinWhileActiveProps) => {
  const prefersReducedMotion = useReducedMotion();
  const shouldSpin = active && !prefersReducedMotion;
  const [turn, setTurn] = useState(() => (shouldSpin ? 1 : 0));
  const [isSpinning, setIsSpinning] = useState(shouldSpin);

  if (shouldSpin && !isSpinning) {
    setIsSpinning(true);
    setTurn((currentTurn) => currentTurn + 1);
  } else if (prefersReducedMotion && isSpinning) {
    setIsSpinning(false);
  }

  return (
    <LazyMotion features={domAnimation}>
      <m.div
        key={isSpinning ? `spin-${turn}` : `idle-${turn}`}
        animate={{ rotate: isSpinning ? 360 : 0 }}
        initial={{ rotate: 0 }}
        onAnimationComplete={() => {
          if (!isSpinning) {
            return;
          }

          if (active && !prefersReducedMotion) {
            setTurn((currentTurn) => currentTurn + 1);
            return;
          }

          setIsSpinning(false);
        }}
        transition={{
          duration: prefersReducedMotion ? 0 : 1,
          ease: [0.75, 0, 0.25, 1],
          rotate: { duration: prefersReducedMotion ? 0 : 1, ease: [0.75, 0, 0.25, 1] },
        }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
};
