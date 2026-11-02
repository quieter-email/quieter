import type { Menu } from "@base-ui/react/menu";
import type { ComponentPropsWithoutRef } from "react";

export const menuFocusProps = {
  onClickCapture(event) {
    if (event.detail !== 0) {
      return;
    }

    for (const item of event.currentTarget.querySelectorAll(
      "[data-pointer-highlighted]"
    )) {
      item.toggleAttribute("data-pointer-highlighted", false);
    }
  },
  onKeyDownCapture(event) {
    for (const item of event.currentTarget.querySelectorAll(
      "[data-pointer-highlighted]"
    )) {
      item.toggleAttribute("data-pointer-highlighted", false);
    }
  },
  onPointerMoveCapture(event) {
    for (const item of event.currentTarget.querySelectorAll(
      "[data-highlighted]"
    )) {
      item.toggleAttribute("data-pointer-highlighted", true);
    }
  },
} satisfies Pick<
  ComponentPropsWithoutRef<typeof Menu.Popup>,
  "onClickCapture" | "onKeyDownCapture" | "onPointerMoveCapture"
>;
