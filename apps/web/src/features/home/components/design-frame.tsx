"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

export const DesignFrame = ({
  children,
  height,
  width,
}: {
  children: ReactNode;
  height: number;
  width: number;
}) => {
  const outer = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = outer.current;
    let observer: ResizeObserver | null = null;
    if (element !== null) {
      const measure = () => {
        setScale(Math.min(element.clientWidth / width, 1));
      };
      observer = new ResizeObserver(measure);
      observer.observe(element);
      measure();
    }
    return () => {
      observer?.disconnect();
    };
  }, [width]);

  return (
    <div
      className="relative mx-auto w-full overflow-hidden"
      ref={outer}
      style={{ aspectRatio: width / height, maxWidth: width }}
    >
      <div
        className="absolute top-0 left-0"
        style={{
          height,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          width,
        }}
      >
        {children}
      </div>
    </div>
  );
};
