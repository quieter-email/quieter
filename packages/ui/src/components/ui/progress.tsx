"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "../../lib/cn";

export const Progress = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>) => (
  <ProgressPrimitive.Root className={cn("grid w-full gap-2", className)} {...props} />
);

export const ProgressLabel = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Label>) => (
  <ProgressPrimitive.Label
    className={cn("text-sm font-medium text-foreground", className)}
    {...props}
  />
);

export const ProgressValue = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Value>) => (
  <ProgressPrimitive.Value className={cn("text-sm text-muted-foreground", className)} {...props} />
);

export const ProgressTrack = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ProgressPrimitive.Track>) => (
  <ProgressPrimitive.Track
    className={cn("relative h-2.5 overflow-hidden rounded-full bg-muted", className)}
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
      className,
    )}
    {...props}
  />
);
