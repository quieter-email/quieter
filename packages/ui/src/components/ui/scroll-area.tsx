"use client";

import type { ComponentProps, ComponentPropsWithoutRef } from "react";
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area";
import { cn } from "../../lib/cn";

export const ScrollArea = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>) => (
  <ScrollAreaPrimitive.Root className={cn("relative overflow-hidden", className)} {...props} />
);

export const ScrollAreaViewport = ({
  className,
  ...props
}: ComponentProps<typeof ScrollAreaPrimitive.Viewport>) => (
  <ScrollAreaPrimitive.Viewport
    className={cn("size-full rounded-[inherit]", className)}
    {...props}
  />
);

export const ScrollAreaContent = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Content>) => (
  <ScrollAreaPrimitive.Content className={cn("min-w-full", className)} {...props} />
);

export const ScrollAreaScrollbar = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Scrollbar>) => (
  <ScrollAreaPrimitive.Scrollbar
    className={cn(
      "flex touch-none p-0.5 transition-colors select-none data-[orientation=horizontal]:h-2.5 data-[orientation=horizontal]:flex-col data-[orientation=vertical]:w-2.5",
      className,
    )}
    {...props}
  />
);

export const ScrollAreaThumb = ({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Thumb>) => (
  <ScrollAreaPrimitive.Thumb
    className={cn("relative flex-1 rounded-full bg-border/80 hover:bg-border", className)}
    {...props}
  />
);

export const ScrollAreaCorner = ScrollAreaPrimitive.Corner;
