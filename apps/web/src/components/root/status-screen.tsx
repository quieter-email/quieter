"use client";

import { lazy, Suspense } from "react";
import type { CSSProperties, ReactNode } from "react";

import type { AtmosphericBackground } from "#/components/atmospheric-background";

/**
 * Shared canvas for the dead ends: not found and unrecoverable errors. Same
 * dark atmosphere and serif voice as the landing page, so a wrong turn still
 * lands somewhere that belongs to the product.
 *
 * The entrance is CSS rather than the landing page's motion variants: this
 * screen has to stay readable when the tree above it has already failed, and
 * a JS-driven reveal renders its copy invisible until a frame is scheduled.
 */

/**
 * Failure-tolerant on purpose: the shader is decoration, and this screen is
 * sometimes the last thing standing after a chunk failed to load.
 */
const NoAtmosphere: typeof AtmosphericBackground = () => (
  <div aria-hidden className="absolute inset-0 bg-black" />
);

const StatusAtmosphere = lazy(async () => {
  try {
    const module = await import("#/components/atmospheric-background");
    return { default: module.AtmosphericBackground };
  } catch {
    return { default: NoAtmosphere };
  }
});

const enterAfter = (seconds: number): CSSProperties => ({
  animationDelay: `${seconds}s`,
});

/** Fills roughly the same width whether the watermark is "404" or a word. */
const ghostStyle = (ghost: string): CSSProperties => ({
  animationDelay: "0.15s",
  fontSize: `clamp(7rem, ${Math.round(120 / ghost.length)}vw, ${Math.round(90 / ghost.length)}rem)`,
});

export const StatusScreen = ({
  actions,
  description,
  ghost,
  note,
  title,
}: {
  actions: ReactNode;
  description: string;
  /** Oversized watermark behind the headline. */
  ghost: string;
  /** One quiet mono line under the copy: the path asked for, or the failure. */
  note?: string;
  title: string;
}) => (
  <main className="dark relative flex min-h-dvh flex-col overflow-hidden bg-black text-fg">
    <div aria-hidden className="absolute inset-0">
      <Suspense fallback={null}>
        <StatusAtmosphere fadeBottom="black" fadeTop="black" />
      </Suspense>
    </div>

    <div className="relative z-10 flex min-h-dvh flex-col items-center justify-center px-6 py-16 text-center">
      <span
        aria-hidden
        className="status-enter pointer-events-none absolute top-1/2 left-1/2 -translate-1/2 font-serif leading-none tracking-[-0.04em] text-fg/[0.05] select-none"
        style={ghostStyle(ghost)}
      >
        {ghost}
      </span>

      <div className="relative flex w-full max-w-160 flex-col items-center">
        <h1
          className="status-enter font-serif text-[2rem] leading-[1.32] font-normal tracking-[-0.014em] text-balance text-fg sm:text-[2.5rem] md:text-[3rem] md:leading-[1.28]"
          style={enterAfter(0.12)}
        >
          {title}
        </h1>

        <p
          className="status-enter mt-6 max-w-125 text-[15px] leading-[1.7] text-balance text-muted-fg"
          style={enterAfter(0.2)}
        >
          {description}
        </p>

        {note === undefined ? null : (
          <p
            className="status-enter mt-5 max-w-125 truncate font-mono text-xs text-fg/40"
            style={enterAfter(0.26)}
          >
            {note}
          </p>
        )}

        <div
          className="status-enter mt-10 flex flex-wrap items-center justify-center gap-3"
          style={enterAfter(0.32)}
        >
          {actions}
        </div>
      </div>
    </div>
  </main>
);
