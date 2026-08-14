"use client";

import { m, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

import { VerticalSlot } from "#/components/vertical-slot";

const waveDots = Array.from({ length: 20 }, (_, index) => ({
  column: index % 10,
  id: index,
}));

/**
 * Shared quiet empty state: atmospheric mark, one short statement, one optional
 * next action. The mark holds still under reduced motion because the global CSS
 * fallback in `apps/web/src/styles.css` only reaches CSS-driven animation.
 */
export const EmptyMessageState = ({
  action,
  description = "Choose a conversation to begin.",
  title = "No conversation open",
}: {
  action?: ReactNode;
  description?: string | null;
  title?: string | null;
}) => {
  const reducedMotion = useReducedMotion();

  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="max-w-sm p-8 text-center">
        <div
          aria-hidden
          className="mx-auto mb-6 grid w-max grid-cols-10 gap-1.5"
        >
          {waveDots.map(({ column, id }) =>
            reducedMotion === true ? (
              <span
                className="inline-block size-1.5 bg-muted-fg opacity-30"
                key={id}
              />
            ) : (
              <m.span
                animate={{ opacity: [0, 0.5, 0] }}
                className="inline-block size-1.5 bg-muted-fg"
                key={id}
                transition={{
                  delay: (9 - column) * 0.18,
                  duration: 2,
                  ease: "easeInOut",
                  repeat: Infinity,
                  repeatDelay: 0,
                }}
              />
            )
          )}
        </div>
        <VerticalSlot>
          <div>
            {title !== null && title !== undefined && title !== "" ? (
              <p className="text-sm font-semibold tracking-tight text-fg">
                {title}
              </p>
            ) : null}
            {description !== null &&
            description !== undefined &&
            description !== "" ? (
              <p className="mt-1.5 text-sm text-muted-fg">{description}</p>
            ) : null}
          </div>
        </VerticalSlot>
        {action === null || action === undefined ? null : (
          <div className="mt-5">{action}</div>
        )}
      </div>
    </div>
  );
};
