"use client";

import {
  getShortcutDisplay,
  KEYBOARD_SHORTCUTS,
} from "@quieter/app/features/hotkeys/domain/keyboard-shortcuts";
import type { KeyboardShortcutId } from "@quieter/app/features/hotkeys/domain/keyboard-shortcuts";
import { useShortcutHintsEnabled } from "@quieter/app/features/settings/domain/shortcut-hints-setting";
import { Kbd } from "@quieter/ui/kbd";
import { detectPlatform } from "@tanstack/hotkeys";
import { useSyncExternalStore } from "react";

export const ShortcutHint = ({
  className,
  shortcutId,
}: {
  className?: string;
  shortcutId: KeyboardShortcutId;
}) => {
  const enabled = useShortcutHintsEnabled();
  const platform = useSyncExternalStore(
    () => () => {
      // The operating system has no change event during this page's lifetime.
    },
    detectPlatform,
    () => "windows" as const
  );
  const shortcut = KEYBOARD_SHORTCUTS.find((item) => item.id === shortcutId);
  if (!enabled || shortcut === undefined) {
    return null;
  }

  return (
    <Kbd aria-hidden className={className} variant="hint">
      {getShortcutDisplay(shortcut, platform)[0]?.join(" ")}
    </Kbd>
  );
};
