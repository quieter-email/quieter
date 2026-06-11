"use client";

import type { ReactNode } from "react";
import { cn } from "@quieter/ui";

export const MessageActions = ({
  align,
  children,
  className,
}: {
  align: "end" | "start";
  children: ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "flex items-center gap-0.5 opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100",
      { "justify-end": align === "end", "justify-start": align === "start" },
      className,
    )}
  >
    {children}
  </div>
);
