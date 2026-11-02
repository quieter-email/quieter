"use client";

import {
  LazyMotion,
  PresenceContext,
  domAnimation,
  m,
  useReducedMotion,
} from "motion/react";
import type { PropsWithChildren } from "react";
import { useState } from "react";

type SpinWhileActiveProps = PropsWithChildren<{
  active: boolean;
}>;

export const SpinWhileActive = ({ active, children }: SpinWhileActiveProps) => {
  const prefersReducedMotion = useReducedMotion();
  const shouldSpin = active && prefersReducedMotion !== true;
  const [turn, setTurn] = useState(() => (shouldSpin ? 1 : 0));
  const [isSpinning, setIsSpinning] = useState(shouldSpin);

  if (shouldSpin && !isSpinning) {
    setIsSpinning(true);
    setTurn((currentTurn) => currentTurn + 1);
  } else if (prefersReducedMotion === true && isSpinning) {
    setIsSpinning(false);
  }

  return (
    <LazyMotion features={domAnimation}>
      <PresenceContext.Provider value={null}>
        <m.div
          key={isSpinning ? `spin-${turn}` : `idle-${turn}`}
          animate={{ rotate: isSpinning ? 360 : 0 }}
          initial={{ rotate: 0 }}
          onAnimationComplete={() => {
            if (!isSpinning) {
              return;
            }

            if (active && prefersReducedMotion !== true) {
              setTurn((currentTurn) => currentTurn + 1);
              return;
            }

            setIsSpinning(false);
          }}
          transition={{
            duration: prefersReducedMotion === true ? 0 : 1,
            ease: [0.75, 0, 0.25, 1],
            rotate: {
              duration: prefersReducedMotion === true ? 0 : 1,
              ease: [0.75, 0, 0.25, 1],
            },
          }}
        >
          {children}
        </m.div>
      </PresenceContext.Provider>
    </LazyMotion>
  );
};
