"use client";

import type { PropsWithChildren } from "react";
import { motion } from "motion/react";

type SpinWhileActiveProps = PropsWithChildren<{
  active: boolean;
}>;

export const SpinWhileActive = ({ active, children }: SpinWhileActiveProps) => (
  <motion.div
    animate={active ? { rotate: 360 } : { rotate: 0 }}
    transition={
      active
        ? {
            duration: 0.9,
            ease: "linear",
            repeat: Number.POSITIVE_INFINITY,
          }
        : {
            duration: 0.2,
          }
    }
  >
    {children}
  </motion.div>
);
