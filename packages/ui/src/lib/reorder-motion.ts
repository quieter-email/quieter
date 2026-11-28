import type { Transition } from "motion/react";

const reorderEase = [0.25, 1, 0.5, 1] as const;
const reorderDurationSeconds = 0.25;

export const reorderTransition = {
  duration: reorderDurationSeconds,
  ease: reorderEase,
  type: "tween",
} satisfies Transition;

export const reorderLayoutTransition = {
  layout: reorderTransition,
} satisfies Transition;

export const reorderAnimation = {
  duration: reorderDurationSeconds * 1000,
  easing: `cubic-bezier(${reorderEase.join(", ")})`,
};
