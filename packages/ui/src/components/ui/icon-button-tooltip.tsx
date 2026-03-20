"use client";

import type { ReactNode } from "react";
import { Tooltip, TooltipArrow, TooltipContent, TooltipTrigger } from "./tooltip";

type IconButtonTooltipProps = {
  children: ReactNode;
  label: string;
  sideOffset?: number;
};

export const IconButtonTooltip = ({ children, label, sideOffset = 6 }: IconButtonTooltipProps) => (
  <Tooltip>
    <TooltipTrigger className="inline-flex" render={<span />}>
      {children}
    </TooltipTrigger>
    <TooltipContent className="min-w-0 px-2 py-1 text-center" sideOffset={sideOffset}>
      {label}
      <TooltipArrow />
    </TooltipContent>
  </Tooltip>
);
