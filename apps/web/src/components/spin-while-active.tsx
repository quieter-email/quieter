import type { JSX } from "solid-js";
import { motion } from "motion-solid";
import { createEffect, createSignal, on } from "solid-js";

const SPIN_DURATION_SECONDS = 1;

export const SpinWhileActive = (props: { active: boolean; children: JSX.Element }) => {
  const [rotation, setRotation] = createSignal(0);
  const [durationSeconds, setDurationSeconds] = createSignal(SPIN_DURATION_SECONDS);

  let animating = false;
  let activeTargetRotation: number | undefined;
  const resetInstantly = () => {
    setDurationSeconds(0);
    setRotation(0);
  };

  const incrementRotation = () => {
    setRotation((currentRotation) => {
      const nextRotation = currentRotation + 360;
      activeTargetRotation = nextRotation;
      return nextRotation;
    });
  };

  const startSpin = () => {
    if (animating) return;
    animating = true;

    if (durationSeconds() !== SPIN_DURATION_SECONDS) {
      setDurationSeconds(SPIN_DURATION_SECONDS);
      queueMicrotask(() => {
        incrementRotation();
      });
      return;
    }

    incrementRotation();
  };

  const onSpinComplete = (definition: unknown) => {
    if (!animating) return;
    const rotate =
      typeof definition === "object" && definition !== null
        ? (definition as { rotate?: unknown }).rotate
        : undefined;
    const completedRotation = typeof rotate === "number" ? rotate : undefined;

    if (
      completedRotation !== undefined &&
      activeTargetRotation !== undefined &&
      completedRotation !== activeTargetRotation
    ) {
      // Ignore stale completion callbacks from prior cycles.
      return;
    }

    animating = false;
    if (props.active) {
      queueMicrotask(() => {
        if (!props.active) {
          resetInstantly();
          return;
        }
        startSpin();
      });
      return;
    }

    resetInstantly();
  };

  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return;
        startSpin();
      },
    ),
  );

  return (
    <motion.span
      class="inline-flex"
      animate={{ rotate: rotation() }}
      transition={{ duration: durationSeconds(), ease: [0.5, 0, 0.5, 1] }}
      onAnimationComplete={onSpinComplete}
    >
      {props.children}
    </motion.span>
  );
};
