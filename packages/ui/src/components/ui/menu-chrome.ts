import { anchoredPopupMotionClassName } from "./overlay-chrome";

export const menuPopupClassName = `${anchoredPopupMotionClassName} z-50 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-52 overflow-x-hidden overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-body text-popover-fg shadow-md outline-none`;

export const menuCompactPopupClassName = "min-w-40 p-0.5 text-caption";

export const menuItemClassName =
  "relative flex min-h-7 cursor-default items-center gap-2 rounded-md px-2.5 text-body-sm text-fg transition-transform duration-100 ease-(--app-motion-ease-out) select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden data-pointer-highlighted:focus-visible:ring-0 data-pointer-highlighted:focus-visible:outline-none active:scale-[0.97] data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-muted motion-reduce:transition-none motion-reduce:active:scale-100";

export const menuCompactItemClassName = "min-h-7 gap-1.5 px-2 text-caption";

export const menuSeparatorClassName = "my-1 h-px bg-border";
