import type { IconSvgElement } from "@hugeicons/react";
import type { CommandMenuItem } from "@quieter/ui/command-menu";

import type { KeyboardShortcutId } from "./keyboard-shortcuts";

export type AppCommand = Omit<
  CommandMenuItem,
  "disabledReason" | "icon" | "shortcut"
> & {
  fallback?: true;
  icon?: IconSvgElement;
  keywords?: string;
  shortcutId?: KeyboardShortcutId;
} & (
    | { execute: () => void | Promise<void>; state: "available" }
    | { reason: string; state: "unavailable" }
  );
