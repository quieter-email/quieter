"use client";

import type { ComponentPropsWithoutRef } from "react";
import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import { cn } from "../../lib/cn";

export const Slider = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Root>) => (
  <SliderPrimitive.Root
    className={cn(
      "group flex w-full touch-none items-center gap-3 data-[orientation=vertical]:h-48 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
      className,
    )}
    {...props}
  />
);

export const SliderValue = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Value>) => (
  <SliderPrimitive.Value
    className={cn("min-w-10 text-sm text-muted-foreground", className)}
    {...props}
  />
);

export const SliderControl = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Control>) => (
  <SliderPrimitive.Control
    className={cn(
      "relative flex-1 data-[orientation=horizontal]:h-5 data-[orientation=vertical]:h-full data-[orientation=vertical]:w-5",
      className,
    )}
    {...props}
  />
);

export const SliderTrack = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Track>) => (
  <SliderPrimitive.Track
    className={cn(
      "relative overflow-hidden rounded-full bg-muted data-[orientation=horizontal]:top-1/2 data-[orientation=horizontal]:h-2 data-[orientation=horizontal]:-translate-y-1/2 data-[orientation=vertical]:mx-auto data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2",
      className,
    )}
    {...props}
  />
);

export const SliderIndicator = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Indicator>) => (
  <SliderPrimitive.Indicator
    className={cn(
      "absolute rounded-full bg-primary data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full",
      className,
    )}
    {...props}
  />
);

export const SliderThumb = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof SliderPrimitive.Thumb>) => (
  <SliderPrimitive.Thumb
    className={cn(
      "block size-4 rounded-full border border-primary/20 bg-background shadow-sm transition-transform duration-150 ease-out outline-none hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
);
