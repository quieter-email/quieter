"use client";

import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ComponentPropsWithoutRef } from "react";

import { cn } from "../../lib/cn";

export const Progress = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) => (
  <ProgressPrimitive.Root
    className={cn("grid w-full gap-2", className)}
    {...props}
  />
);

export const ProgressLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Label>) => (
  <ProgressPrimitive.Label
    className={cn("text-body font-medium text-fg", className)}
    {...props}
  />
);

export const ProgressValue = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Value>) => (
  <ProgressPrimitive.Value
    className={cn("text-body text-muted-fg", className)}
    {...props}
  />
);

export const ProgressTrack = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Track>) => (
  <ProgressPrimitive.Track
    className={cn(
      "relative h-2.5 overflow-hidden rounded-full bg-muted",
      className
    )}
    {...props}
  />
);

export const ProgressIndicator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Indicator>) => (
  <ProgressPrimitive.Indicator
    className={cn(
      "h-full rounded-full bg-primary transition-[width] duration-200 ease-out",
      className
    )}
    {...props}
  />
);

// Compact progress for flow headers, e.g. onboarding and mailbox setup.
export const FlowProgress = ({
  label,
  max,
  value,
}: {
  label: string;
  max: number;
  value: number;
}) => (
  <Progress
    aria-label={label}
    className="hidden w-16 gap-0 sm:grid"
    max={max}
    value={value}
  >
    <ProgressTrack className="h-1 bg-control-hover">
      <ProgressIndicator className="bg-fg" />
    </ProgressTrack>
  </Progress>
);
