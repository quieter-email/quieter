export const sidebarActiveSurfaceClassName =
  "pointer-events-none absolute inset-0 z-0 rounded-md bg-background squircle";

export const sidebarHoverSurfaceClassName = "rounded-md bg-background/50 squircle";

export const sidebarHoverSurfaceItemClassName =
  "block size-full rounded-md bg-background/50 squircle";

export const sidebarSurfaceSpringTransition = {
  layout: { type: "spring" as const, stiffness: 1200, damping: 52, mass: 0.3 },
};

export const sidebarSurfaceFadeTransition = {
  opacity: { duration: 0.08, ease: "easeOut" as const },
  scale: { duration: 0.08, ease: "easeOut" as const },
};

export const sidebarNavButtonClassName =
  "relative z-10 w-full bg-transparent hover:bg-transparent active:scale-100 active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:hover:bg-transparent aria-[current=page]:active:bg-transparent motion-reduce:active:scale-100";
