"use client";

import { cn } from "@quieter/ui/cn";
import { m, stagger as staggerChildren, useReducedMotion } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";

const motionElements = {
  div: m.div,
  fieldset: m.fieldset,
  h2: m.h2,
  header: m.header,
  p: m.p,
  span: m.span,
};

const EASE = [0.215, 0.61, 0.355, 1] as const;

// CSS removes blur and movement for reduced motion without changing SSR styles.
const entranceVariants = {
  hidden: { filter: "blur(10px)", opacity: 0, transform: "translateY(10px)" },
  visible: {
    filter: "blur(0px)",
    opacity: 1,
    transform: "translateY(0px)",
  },
};

type RevealProps = {
  as?: keyof typeof motionElements;
  children?: ReactNode;
  className?: string;
  id?: string;
  delay?: number;
  onMount?: boolean;
  stagger?: number;
} & Pick<
  HTMLAttributes<HTMLElement>,
  "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
>;

/** Plays the entrance once, the first time the element scrolls into view. */
export const Reveal = ({
  as,
  children,
  className,
  delay = 0,
  onMount = false,
  stagger,
  ...props
}: RevealProps) => {
  const reduced = useReducedMotion();
  const variants =
    stagger === undefined
      ? entranceVariants
      : {
          hidden: {},
          visible: {
            transition: {
              delayChildren:
                reduced === true
                  ? 0
                  : staggerChildren(stagger, { startDelay: delay }),
            },
          },
        };
  const duration = onMount ? 1.4 : 1.25;
  const Component = motionElements[as ?? "div"];

  return (
    <Component
      {...props}
      animate={onMount ? "visible" : undefined}
      className={cn("home-reveal", className)}
      initial="hidden"
      transition={{
        delay: reduced === true ? 0 : delay,
        duration: reduced === true ? 0.2 : duration,
        ease: EASE,
      }}
      variants={variants}
      viewport={{ margin: "-48px", once: true }}
      whileInView={onMount ? undefined : "visible"}
    >
      {children}
    </Component>
  );
};

export const RevealChild = ({
  as,
  children,
  className,
  ...props
}: Omit<RevealProps, "delay" | "onMount" | "stagger">) => {
  const reduced = useReducedMotion();
  const Component = motionElements[as ?? "div"];

  return (
    <Component
      {...props}
      className={cn("home-reveal", className)}
      transition={{
        duration: reduced === true ? 0.2 : 1.25,
        ease: EASE,
      }}
      variants={entranceVariants}
    >
      {children}
    </Component>
  );
};
