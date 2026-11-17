"use client";

import type { ReactNode } from "react";

import { cn } from "../../lib/cn";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type IconButtonTooltipProps = {
  children: ReactNode;
  label: string;
  sideOffset?: number;
  triggerClassName?: string;
};

export const IconButtonTooltip = ({
  children,
  label,
  sideOffset = 6,
  triggerClassName,
}: IconButtonTooltipProps) => (
  <Tooltip>
    <TooltipTrigger
      className={cn("inline-flex", triggerClassName)}
      render={<span />}
    >
      {children}
    </TooltipTrigger>
    <TooltipContent
      className="min-w-0 px-2 py-1 text-center"
      sideOffset={sideOffset}
    >
      {label}
    </TooltipContent>
  </Tooltip>
);
