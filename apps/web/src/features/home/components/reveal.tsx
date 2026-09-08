"use client";

import { m, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import type { HTMLAttributes, ReactNode } from "react";

const motionElements = {
  div: m.div,
  fieldset: m.fieldset,
  h2: m.h2,
  p: m.p,
  span: m.span,
};

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Shared entrance for the landing page: a short lift out of a blur.
 *
 * Under `prefers-reduced-motion` the movement and blur are dropped and only the
 * opacity remains, so the page still resolves without anything travelling.
 */
const getEntranceVariants = (reduced: boolean | null) => ({
  hidden:
    reduced === true
      ? { opacity: 0 }
      : { filter: "blur(8px)", opacity: 0, transform: "translateY(16px)" },
  visible: {
    filter: "blur(0px)",
    opacity: 1,
    transform: "translateY(0px)",
  },
});

type RevealProps = {
  as?: keyof typeof motionElements;
  children: ReactNode;
  className?: string;
  id?: string;
  delay?: number;
  onMount?: boolean;
} & Pick<
  HTMLAttributes<HTMLElement>,
  "onBlur" | "onFocus" | "onMouseEnter" | "onMouseLeave"
>;

/** Plays the entrance once, the first time the element scrolls into view. */
export const Reveal = ({
  as,
  children,
  delay = 0,
  onMount = false,
  ...props
}: RevealProps) => {
  const reduced = useReducedMotion();
  const variants = getEntranceVariants(reduced);
  const duration = onMount ? 0.8 : 0.7;
  const Component = motionElements[as ?? "div"];

  return (
    <Component
      {...props}
      animate={onMount ? "visible" : undefined}
      initial="hidden"
      transition={{
        delay,
        duration: reduced === true ? 0.3 : duration,
        ease: EASE,
      }}
      variants={variants}
      viewport={{ margin: "-80px", once: true }}
      whileInView={onMount ? undefined : "visible"}
    >
      {children}
    </Component>
  );
};

type RevealChildProps = {
  children: ReactNode;
  delay?: number;
} & Omit<HTMLMotionProps<"div">, "children">;

export const RevealChild = ({
  children,
  delay = 0,
  ...props
}: RevealChildProps) => {
  const reduced = useReducedMotion();
  const variants = getEntranceVariants(reduced);

  return (
    <m.div
      {...props}
      transition={{
        delay,
        duration: reduced === true ? 0.3 : 0.7,
        ease: EASE,
      }}
      variants={variants}
    >
      {children}
    </m.div>
  );
};
