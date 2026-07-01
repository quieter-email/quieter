"use client";

import { type PropsWithChildren, useEffect } from "react";

const keyboardFocusKeys = new Set(["/", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "Tab"]);

const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    target.matches(
      'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]), textarea',
    ));

export const FocusModalityProvider = ({ children }: PropsWithChildren) => {
  useEffect(() => {
    const setKeyboardFocus = (enabled: boolean) => {
      document.documentElement.toggleAttribute("data-keyboard-focus", enabled);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        keyboardFocusKeys.has(event.key) ||
        ((event.key === "Enter" || event.key === " ") && !isTextEntryTarget(event.target))
      ) {
        setKeyboardFocus(true);
      }
    };

    const handlePointerDown = () => setKeyboardFocus(false);

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, []);

  return children;
};
