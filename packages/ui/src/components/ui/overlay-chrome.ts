export const overlayTriggerClassName =
  "transition-transform duration-100 ease-(--app-motion-ease-out) focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-hidden active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

export const anchoredTriggerClassName = `${overlayTriggerClassName} active:scale-100`;

export const overlayBackdropClassName =
  "fixed inset-0 z-50 bg-black/50 backdrop-blur-xs transition-opacity duration-150 ease-(--app-motion-ease-out) data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:opacity-0";

// Inspectors leave the view they describe readable, so they dim without blur.
export const overlayInspectorBackdropClassName =
  "fixed inset-0 z-50 bg-black/20 transition-opacity duration-150 ease-(--app-motion-ease-out) data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:opacity-0";

export const overlaySurfaceClassName =
  "border border-panel-edge/30 bg-panel text-fg shadow-lg";

const overlayPopupMotionClassName =
  "transition-[opacity,scale] ease-(--app-motion-ease-out) will-change-[opacity,scale] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-ending-style:duration-100 data-starting-style:scale-[0.98] data-starting-style:opacity-0 motion-reduce:transition-opacity motion-reduce:data-ending-style:scale-100 motion-reduce:data-starting-style:scale-100";

export const overlayPopupClassName = `${overlaySurfaceClassName} fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-1/2 overflow-hidden rounded-panel duration-150 ${overlayPopupMotionClassName}`;

// Keyboard palettes sit in the upper third so the search field stays put while
// results change height, and open near-instantly.
export const overlayCommandPopupClassName = `border border-fg/10 bg-panel text-fg shadow-2xl fixed top-[8vh] left-1/2 z-50 w-[min(94vw,38rem)] -translate-x-1/2 overflow-hidden rounded-panel duration-100 sm:top-[min(14vh,8rem)] ${overlayPopupMotionClassName}`;

// Inspectors hang below the workspace header tray and align with its edge.
// Nested dialogs render no backdrop, so the inspector dims itself behind them.
export const overlayInspectorPopupClassName = `${overlaySurfaceClassName} fixed top-18 right-2 z-50 flex max-h-[calc(100dvh-5rem)] w-[min(calc(100vw-1rem),26rem)] origin-top-right flex-col overflow-hidden rounded-panel duration-150 after:pointer-events-none after:absolute after:inset-0 after:z-30 after:hidden after:bg-black/30 data-nested-dialog-open:after:block lg:top-20 lg:right-4 lg:max-h-[calc(100dvh-6rem)] ${overlayPopupMotionClassName}`;

export const overlayTitleClassName = "truncate text-body-lg font-medium";

export const overlayDescriptionClassName = "mt-2 text-body-sm/5 text-muted-fg";

export const anchoredPopupMotionClassName =
  "origin-(--transform-origin) transition-[opacity,scale,translate] duration-(--app-motion-duration-enter) ease-(--app-motion-ease-out) data-starting-style:opacity-0 data-ending-style:opacity-0 data-ending-style:duration-100 data-instant:transition-none motion-safe:data-starting-style:scale-[0.97] motion-safe:data-ending-style:scale-[0.97] motion-safe:data-[side=bottom]:data-starting-style:-translate-y-0.5 motion-safe:data-[side=bottom]:data-ending-style:-translate-y-0.5 motion-safe:data-[side=top]:data-starting-style:translate-y-0.5 motion-safe:data-[side=top]:data-ending-style:translate-y-0.5 motion-safe:data-[side=right]:data-starting-style:-translate-x-0.5 motion-safe:data-[side=right]:data-ending-style:-translate-x-0.5 motion-safe:data-[side=left]:data-starting-style:translate-x-0.5 motion-safe:data-[side=left]:data-ending-style:translate-x-0.5 motion-reduce:transition-opacity";
