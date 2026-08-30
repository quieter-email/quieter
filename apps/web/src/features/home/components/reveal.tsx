"use client";

import { m, useReducedMotion } from "motion/react";
import type { HTMLMotionProps } from "motion/react";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

const EASE = [0.23, 1, 0.32, 1] as const;

/**
 * Shared entrance for the landing page: a short lift out of a blur.
 *
 * Under `prefers-reduced-motion` the movement and blur are dropped and only the
 * opacity remains, so the page still resolves without anything travelling.
 */
export const useEntrance = (reduced: boolean | null) => ({
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

type RevealProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  /** Seconds to wait before this element starts. */
  delay?: number;
} & Omit<ComponentPropsWithoutRef<T>, "children">;

/** Plays the entrance once, the first time the element scrolls into view. */
export const Reveal = <T extends ElementType = "div">({
  as,
  children,
  delay = 0,
  ...props
}: RevealProps<T>) => {
  const reduced = useReducedMotion();
  const variants = useEntrance(reduced);
  const Component = m.create(as ?? "div");

  return (
    <Component
      {...props}
      initial="hidden"
      transition={{
        delay,
        duration: reduced === true ? 0.3 : 0.7,
        ease: EASE,
      }}
      variants={variants}
      viewport={{ margin: "-80px", once: true }}
      whileInView="visible"
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
  const variants = useEntrance(reduced);

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

/** Same entrance, but on mount rather than on scroll. For above-the-fold content. */
export const Entrance = <T extends ElementType = "div">({
  as,
  children,
  delay = 0,
  ...props
}: RevealProps<T>) => {
  const reduced = useReducedMotion();
  const variants = useEntrance(reduced);
  const Component = m.create(as ?? "div");

  return (
    <Component
      {...props}
      animate="visible"
      initial="hidden"
      transition={{
        delay,
        duration: reduced === true ? 0.3 : 0.8,
        ease: EASE,
      }}
      variants={variants}
    >
      {children}
    </Component>
  );
};
