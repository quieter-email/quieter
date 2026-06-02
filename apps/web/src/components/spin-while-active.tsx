"use client";

import type { PropsWithChildren } from "react";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useRef, useState } from "react";

const SPIN_DURATION_S = 0.9;

type SpinWhileActiveProps = PropsWithChildren<{
  active: boolean;
}>;

export const SpinWhileActive = ({ active, children }: SpinWhileActiveProps) => {
  const prefersReducedMotion = useReducedMotion();
  const shouldSpin = active && !prefersReducedMotion;
  const activeRef = useRef(active);
  const prefersReducedMotionRef = useRef(prefersReducedMotion);
  const [turn, setTurn] = useState(() => (shouldSpin ? 1 : 0));
  const [isSpinning, setIsSpinning] = useState(shouldSpin);

  activeRef.current = active;
  prefersReducedMotionRef.current = prefersReducedMotion;

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
        className="inline-flex origin-center"
        initial={isSpinning ? { rotate: 0 } : false}
        onAnimationComplete={() => {
          if (!isSpinning) {
            return;
          }

          if (activeRef.current && !prefersReducedMotionRef.current) {
            setTurn((currentTurn) => currentTurn + 1);
            return;
          }

          setIsSpinning(false);
        }}
        transition={{
          duration: prefersReducedMotion ? 0 : SPIN_DURATION_S,
          ease: [0.75, 0, 0.25, 1],
          rotate: {
            duration: prefersReducedMotion ? 0 : SPIN_DURATION_S,
            ease: [0.75, 0, 0.25, 1],
          },
        }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
};
