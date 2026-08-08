"use client";

import type { ReactNode } from "react";
import { ReactLenis } from "lenis/react";
import { useReducedMotion } from "motion/react";
import "lenis/dist/lenis.css";

type HomeSmoothScrollProps = {
  children: ReactNode;
};

/**
 * Landing-only smooth scroll via Lenis. Skips when the user prefers reduced
 * motion so native scroll (and the global reduced-motion CSS) stay in charge.
 */
export const HomeSmoothScroll = ({ children }: HomeSmoothScrollProps) => {
  const reduced = useReducedMotion();

  if (reduced) return children;

  return (
    <ReactLenis
      options={{
        anchors: true,
        autoRaf: true,
        // Keep touch close to native; desktop wheel gets the lerp.
        syncTouch: false,
      }}
      root
    >
      {children}
    </ReactLenis>
  );
};
