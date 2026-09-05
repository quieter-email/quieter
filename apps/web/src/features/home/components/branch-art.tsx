"use client";

import { cn } from "@quieter/ui/cn";
import { useEffect, useRef, useState } from "react";

export const BranchArt = ({
  className,
  side,
}: {
  className?: string;
  side: "left" | "right";
}) => {
  const ref = useRef<HTMLImageElement | null>(null);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    let observer: IntersectionObserver | null = null;

    if (element !== null) {
      observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setGrown(true);
            observer?.disconnect();
          }
        },
        { threshold: 0.2 }
      );

      observer.observe(element);
    }

    return () => {
      observer?.disconnect();
    };
  }, []);

  return (
    <img
      alt=""
      className={cn(
        "home-branch pointer-events-none absolute object-cover",
        {
          "home-branch-left": side === "left",
          "home-branch-right": side === "right",
        },
        className
      )}
      data-grown={grown}
      decoding="async"
      loading="lazy"
      ref={ref}
      src={
        side === "left"
          ? "/landing/branch-left.png"
          : "/landing/branch-right.png"
      }
    />
  );
};
