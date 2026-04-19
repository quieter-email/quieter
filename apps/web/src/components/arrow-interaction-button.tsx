"use client";

import { ArrowUp01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, type ButtonProps, cn } from "@quietr/ui";
import { m, useReducedMotion } from "motion/react";
import { useState } from "react";

type ArrowInteractionButtonClickEvent = Parameters<NonNullable<ButtonProps["onClick"]>>[0];

export const ArrowInteractionButton = ({
  className,
  onClick,
  ...props
}: Omit<ButtonProps, "onClick"> & {
  onClick: (event: ArrowInteractionButtonClickEvent) => boolean | Promise<boolean>;
}) => {
  const shouldReduceMotion = useReducedMotion() ?? false;
  const [animation, setAnimation] = useState({
    kind: "idle" as "idle" | "success" | "failure",
    nonce: 0,
  });

  return (
    <Button
      {...props}
      className={cn("relative overflow-hidden", className)}
      onClick={(event) => {
        void Promise.resolve(onClick(event))
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
      <span className="pointer-events-none absolute inset-0 inline-grid place-items-center overflow-hidden leading-none">
        <span aria-hidden="true" className="pointer-events-none opacity-0">
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </span>
        <m.span
          key={`primary-${animation.kind}-${animation.nonce}`}
          animate={
            animation.kind === "success"
              ? {
                  opacity: [1, 1, 0.88],
                  transform: [
                    "translateY(0%) scaleX(1) scaleY(1)",
                    "translateY(10%) scaleX(0.95) scaleY(0.98)",
                    "translateY(-120%) scaleX(0.82) scaleY(1.08)",
                  ],
                }
              : animation.kind === "failure"
                ? {
                    transform: [
                      "translateY(0%) scaleX(1) scaleY(1)",
                      "translateY(-40%) scaleX(0.97) scaleY(0.97)",
                      "translateY(-18%) scaleX(1) scaleY(1)",
                      "translateY(0%) scaleX(1) scaleY(1)",
                    ],
                  }
                : { opacity: 1, transform: "translateY(0%) scaleX(1) scaleY(1)" }
          }
          className="pointer-events-none absolute inset-0 inline-grid place-items-center will-change-transform"
          initial={
            animation.kind === "failure"
              ? { transform: "translateY(0%) scaleX(1) scaleY(1)" }
              : { opacity: 1, transform: "translateY(0%) scaleX(1) scaleY(1)" }
          }
          transition={
            animation.kind === "success"
              ? { duration: 1.2, ease: [0.22, 1, 0.36, 1], times: [0, 0.42, 1] }
              : animation.kind === "failure"
                ? { duration: 1.28, ease: [0.22, 1, 0.36, 1], times: [0, 0.38, 0.68, 1] }
                : { duration: 0 }
          }
        >
          <HugeiconsIcon icon={ArrowUp01Icon} />
        </m.span>
        {animation.kind === "success" ? (
          <m.span
            key={`secondary-${animation.nonce}`}
            animate={{ opacity: 1, transform: "translateY(0%) scaleX(1) scaleY(1)" }}
            className="pointer-events-none absolute inset-0 inline-grid place-items-center will-change-transform"
            initial={{ opacity: 1, transform: "translateY(120%) scaleX(0.88) scaleY(1.04)" }}
            transition={{ bounce: 0.14, delay: 0.22, duration: 1.42, type: "spring" }}
          >
            <HugeiconsIcon icon={ArrowUp01Icon} />
          </m.span>
        ) : null}
      </span>
    </Button>
  );
};
