import { anchoredPopupMotionClassName } from "./overlay-chrome";
import { popupSurfaceClassName } from "./popup-surface";

export const menuListPaddingClassName = "p-1.5";

export const menuSurfaceClassName = `${popupSurfaceClassName} rounded-xl`;

export const menuPopupClassName = `${anchoredPopupMotionClassName} ${menuSurfaceClassName} ${menuListPaddingClassName} z-50 max-h-[calc(100dvh-1rem)] max-w-[calc(100vw-1rem)] min-w-52 overflow-x-hidden overflow-y-auto overscroll-contain text-body outline-none`;

export const menuCompactPopupClassName = "min-w-40 p-1 text-caption";

export const menuItemClassName =
  "relative flex min-h-8 cursor-default items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-body-sm text-popover-fg select-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-hidden data-pointer-highlighted:focus-visible:ring-0 data-pointer-highlighted:focus-visible:outline-none data-disabled:pointer-events-none data-disabled:opacity-50 data-highlighted:bg-popover-highlight";

export const menuCompactItemClassName =
  "min-h-7 gap-1.5 px-2 py-1 text-caption";

export const menuGroupLabelClassName = "px-2.5 py-1 text-caption text-muted-fg";

export const menuCompactGroupLabelClassName = "px-2 py-0.5 text-micro";

export const menuEmptyClassName = "px-3 py-4 text-body-sm text-muted-fg";

export const menuSeparatorClassName = "my-1.5 h-px bg-fg/10";
