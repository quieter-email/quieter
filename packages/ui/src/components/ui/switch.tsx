"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "../../lib/cn";

export const Switch = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>) => (
  <SwitchPrimitive.Root
    className={cn(
      "squircle inline-flex h-6 w-11 items-center rounded-full bg-bg-elevated/60 p-0.5 transition-colors duration-150 ease-out focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/45 focus-visible:outline-none data-checked:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50",
      className,
    )}
    {...props}
  />
);

export const SwitchThumb = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SwitchPrimitive.Thumb>) => (
  <SwitchPrimitive.Thumb
    className={cn(
      "squircle block size-5 rounded-full bg-bg shadow-sm transition-transform duration-150 ease-out data-checked:translate-x-5",
      className,
    )}
    {...props}
  />
);
