"use client";

export const focusRingClassName =
  "outline-none transition-colors duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export const overlayBackdropClassName = "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm";

export const overlayPanelClassName =
  "z-50 rounded-xl border border-border bg-popover text-popover-foreground shadow-lg outline-none";

export const floatingPanelClassName =
  "z-50 min-w-52 rounded-lg border border-border bg-popover text-popover-foreground shadow-md outline-none";

export const interactiveItemClassName =
  "relative flex min-h-9 items-center gap-2 rounded-md text-sm text-foreground outline-none transition-colors duration-150 ease-out select-none data-disabled:pointer-events-none data-disabled:opacity-50";
