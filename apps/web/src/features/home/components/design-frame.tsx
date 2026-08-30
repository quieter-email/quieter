"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

const DESIGN_WIDTH = 1654;

export const DesignFrame = ({ children }: { children: ReactNode }) => {
  const outer = useRef<HTMLDivElement | null>(null);
  const inner = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({
    height: 0,
    offset: 0,
    scale: 1,
  });

  useEffect(() => {
    const outerElement = outer.current;
    const innerElement = inner.current;
    let observer: ResizeObserver | null = null;

    if (outerElement !== null && innerElement !== null) {
      const measure = () => {
        const availableWidth = outerElement.clientWidth;
        const scale = Math.min(availableWidth / DESIGN_WIDTH, 1);

        setDimensions({
          height: innerElement.offsetHeight * scale,
          offset: Math.max((availableWidth - DESIGN_WIDTH * scale) / 2, 0),
          scale,
        });
      };

      observer = new ResizeObserver(measure);
      observer.observe(outerElement);
      observer.observe(innerElement);
      measure();
    }

    return () => {
      observer?.disconnect();
    };
  }, []);

  return (
    <div
      className="w-full overflow-hidden"
      ref={outer}
      style={
        dimensions.height === 0 ? undefined : { height: dimensions.height }
      }
    >
      <div
        ref={inner}
        style={{
          marginLeft: dimensions.offset,
          transform: `scale(${dimensions.scale})`,
          transformOrigin: "top left",
          width: DESIGN_WIDTH,
        }}
      >
        {children}
      </div>
    </div>
  );
};
