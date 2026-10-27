export const overlayTriggerClassName =
  "transition-transform duration-100 ease-out focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg-raised focus-visible:outline-none active:scale-[0.97] motion-reduce:transition-none motion-reduce:active:scale-100";

export const overlayBackdropClassName =
  "fixed inset-0 z-50 bg-black/50 backdrop-blur-sm transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0";

export const overlayPopupClassName =
  "fixed top-1/2 left-1/2 z-50 w-[min(92vw,30rem)] -translate-1/2 overflow-hidden rounded-xl border shadow-lg transition-[opacity,scale] duration-150 ease-out will-change-[opacity,scale] data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0";

export const overlayTitleClassName = "truncate text-body-lg font-medium";

export const overlayDescriptionClassName = "mt-2 text-body-sm/5 text-muted-fg";
