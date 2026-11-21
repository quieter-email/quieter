import type { CommandMenuItem } from "@quieter/ui/command-menu";

import type { KeyboardShortcutId } from "./keyboard-shortcuts";

export type AppCommand = Omit<
  CommandMenuItem,
  "disabledReason" | "shortcut"
> & {
  fallback?: true;
  keywords?: string;
  shortcutId?: KeyboardShortcutId;
} & (
    | { execute: () => void | Promise<void>; state: "available" }
    | { reason: string; state: "unavailable" }
  );
