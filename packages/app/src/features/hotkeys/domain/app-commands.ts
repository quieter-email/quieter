import type { CommandMenuItem } from "@quieter/ui/command-menu";

import type { KeyboardShortcutId } from "./keyboard-shortcuts";

export type AppCommand = Omit<
  CommandMenuItem,
  "disabledReason" | "shortcut"
> & {
  keywords?: string;
  shortcutId?: KeyboardShortcutId;
} & (
    | { execute: () => void | Promise<void>; state: "available" }
    | { reason: string; state: "unavailable" }
  );
