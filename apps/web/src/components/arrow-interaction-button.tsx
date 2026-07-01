"use client";

import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, type ButtonProps } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { useState } from "react";

type ArrowIconMotionKind = "idle" | "success" | "failure";

const arrowPrimaryVariants = {
  idle: {
    opacity: 1,
    transform: "translateY(0%) scaleX(1) scaleY(1)",
    transition: { duration: 0 },
  },
  successFrom: {
    opacity: 1,
    transform: "translateY(0%) scaleX(1) scaleY(1)",
  },
  failureFrom: {
    transform: "translateY(0%) scaleX(1) scaleY(1)",
  },
  success: {
    opacity: [1, 1, 0.88],
    transform: [
      "translateY(0%) scaleX(1) scaleY(1)",
      "translateY(10%) scaleX(0.95) scaleY(0.98)",
      "translateY(-120%) scaleX(0.82) scaleY(1.08)",
    ],
    transition: {
      duration: 1,
      ease: [0.22, 1, 0.36, 1] as const,
      times: [0, 0.42, 1],
    },
  },
  failure: {
    transform: [
      "translateY(0%) scaleX(1) scaleY(1)",
      "translateY(-40%) scaleX(0.97) scaleY(0.97)",
      "translateY(-18%) scaleX(1) scaleY(1)",
      "translateY(0%) scaleX(1) scaleY(1)",
    ],
    transition: {
      duration: 1,
      ease: [0.22, 1, 0.36, 1] as const,
      times: [0, 0.38, 0.68, 1],
    },
  },
};

const arrowSecondaryVariants = {
  from: {
    opacity: 1,
    transform: "translateY(120%) scaleX(0.88) scaleY(1.04)",
  },
  to: {
    opacity: 1,
    transform: "translateY(0%) scaleX(1) scaleY(1)",
    transition: { bounce: 0.14, delay: 0.22, duration: 1.42, type: "spring" as const },
  },
};

const arrowPrimaryInitial: Record<ArrowIconMotionKind, keyof typeof arrowPrimaryVariants> = {
  idle: "idle",
  success: "successFrom",
  failure: "failureFrom",
};

export const ArrowInteractionButton = ({ className, onClick, ...props }: ButtonProps) => {
  const shouldReduceMotion = useReducedMotion() ?? false;
  const [animation, setAnimation] = useState<{ kind: ArrowIconMotionKind; nonce: number }>({
    kind: "idle",
    nonce: 0,
  });

  return (
    <Button
      {...props}
      className={cn("relative overflow-hidden", className)}
      onClick={(event) => {
        void Promise.resolve(onClick?.(event))
          .then((success) => {
            if (shouldReduceMotion) return;
            setAnimation((previous) => ({
              kind: success ? "success" : "failure",
              nonce: previous.nonce + 1,
            }));
          })
          .catch(() => {
            if (shouldReduceMotion) return;
            setAnimation((previous) => ({ kind: "failure", nonce: previous.nonce + 1 }));
          });
      }}
    >
      <span aria-hidden="true" className="pointer-events-none opacity-0">
        <HugeiconsIcon icon={ArrowUp01Icon} />
      </span>
      <LazyMotion features={domAnimation}>
        <span className="pointer-events-none absolute inset-0 inline-grid place-items-center overflow-hidden">
          <span aria-hidden="true" className="pointer-events-none opacity-0">
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </span>
          <m.span
            key={`primary-${animation.kind}-${animation.nonce}`}
            animate={animation.kind}
            className="pointer-events-none absolute inset-0 inline-grid place-items-center will-change-transform"
            initial={arrowPrimaryInitial[animation.kind]}
            variants={arrowPrimaryVariants}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </m.span>
          {animation.kind === "success" && (
            <m.span
              key={`secondary-${animation.nonce}`}
              animate="to"
              className="pointer-events-none absolute inset-0 inline-grid place-items-center will-change-transform"
              initial="from"
              variants={arrowSecondaryVariants}
            >
              <HugeiconsIcon icon={ArrowUp01Icon} />
            </m.span>
          )}
        </span>
      </LazyMotion>
    </Button>
  );
};
