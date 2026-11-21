// @vitest-environment jsdom
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@quieter/ui/alert-dialog";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@quieter/ui/context-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@quieter/ui/popover";
import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, test, vi } from "vite-plus/test";

import {
  CommandPaletteProvider,
  useRegisterCommands,
} from "./command-palette-context";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const ScopedCommands = ({
  onExecute,
  scope,
}: {
  onExecute: () => void;
  scope: string;
}) => {
  useRegisterCommands(
    [
      {
        execute: onExecute,
        group: "Mail",
        id: "fixture-action",
        label: "Fixture action",
        state: "available",
      },
    ],
    scope
  );
  return null;
};

describe("scoped command execution", () => {
  test("keeps an open context menu in charge without a popup button", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <ContextMenu>
                <ContextMenuTrigger id="fixture-context-target">
                  Fixture conversation
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem>Fixture action</ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      const trigger = container.querySelector("#fixture-context-target");
      if (trigger === null) {
        throw new Error("The fixture did not mount.");
      }
      act(() => {
        trigger.dispatchEvent(
          new MouseEvent("contextmenu", {
            bubbles: true,
            button: 2,
            clientX: 10,
            clientY: 10,
          })
        );
      });
      await vi.waitFor(() => {
        expect(
          document.querySelector("[role='menu'][data-open]")
        ).not.toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps a controlled confirmation in charge of keyboard input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    const render = (confirmationOpen: boolean) => {
      root.render(
        <HotkeysProvider>
          <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
            <AlertDialog open={confirmationOpen}>
              <AlertDialogContent>
                <AlertDialogTitle>Fixture confirmation</AlertDialogTitle>
                <AlertDialogDescription>
                  Review the current action.
                </AlertDialogDescription>
              </AlertDialogContent>
            </AlertDialog>
          </CommandPaletteProvider>
        </HotkeysProvider>
      );
    };
    try {
      act(() => {
        render(true);
      });
      expect(document.querySelector("[role='alertdialog']")).not.toBeNull();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
      act(() => {
        render(false);
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='alertdialog']")).toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).not.toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("drops a pending action when its mailbox or selection changes before execution", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const previous = vi.fn<() => void>();
    const current = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const render = (scope: string, execute: () => void) => {
      root.render(
        <HotkeysProvider>
          <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
            <ScopedCommands onExecute={execute} scope={scope} />
          </CommandPaletteProvider>
        </HotkeysProvider>
      );
    };
    try {
      act(() => {
        render("mailbox-a:thread-a", previous);
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const option = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ].find((item) => item.textContent === "Fixture action");
      if (option === undefined) {
        throw new Error("The palette did not open.");
      }
      act(() => {
        option.click();
        render("mailbox-b:thread-b", current);
      });
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
      expect(previous).not.toHaveBeenCalled();
      expect(current).not.toHaveBeenCalled();
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      act(() => {
        [...document.querySelectorAll<HTMLButtonElement>("[role='option']")]
          .find((item) => item.textContent === "Fixture action")
          ?.click();
      });
      await vi.waitFor(() => {
        expect(current).toHaveBeenCalledOnce();
      });
      expect(previous).not.toHaveBeenCalled();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("toggles closed on Mod+Shift+K and matches multi-word queries with available actions first", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const markRead = vi.fn<() => void>();
    const showHelp = vi.fn<() => void>();
    const MixedCommands = () => {
      useRegisterCommands(
        [
          {
            execute: () => {
              // Fixture action.
            },
            group: "Accounts",
            id: "switch-account",
            label: "Switch to Work",
            state: "available",
          },
          {
            group: "Conversation actions",
            id: "mark-archive",
            label: "Mark as Archived",
            reason: "Select a conversation first.",
            state: "unavailable",
          },
          {
            execute: markRead,
            group: "Conversation actions",
            id: "mark-read",
            label: "Mark as Read",
            shortcutId: "list-mark-read",
            state: "available",
          },
        ],
        "mixed"
      );
      return null;
    };
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <MixedCommands />
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      const options = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ];
      expect(options[0]?.textContent).toContain("Mark as Read");
      expect(options[1]?.textContent).toContain("Mark as Archived");

      const input =
        document.querySelector<HTMLInputElement>("[role='combobox']");
      if (input === null) {
        throw new Error("Search input did not mount.");
      }
      act(() => {
        const valueDescriptor = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value"
        );
        valueDescriptor?.set?.call(input, "mark read");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const filteredOptions = [
        ...document.querySelectorAll<HTMLButtonElement>("[role='option']"),
      ];
      expect(filteredOptions).toHaveLength(1);
      expect(filteredOptions[0]?.textContent).toContain("Mark as Read");

      const toggleCloseEvent = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: "K",
        shiftKey: true,
      });
      act(() => {
        document.dispatchEvent(toggleCloseEvent);
      });
      expect(toggleCloseEvent.defaultPrevented).toBeTruthy();
      await vi.waitFor(() => {
        expect(document.querySelector("[role='dialog']")).toBeNull();
      });
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });

  test("keeps an open popover in charge of keyboard input", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const showHelp = vi.fn<() => void>();
    try {
      act(() => {
        root.render(
          <HotkeysProvider>
            <CommandPaletteProvider onShowKeyboardShortcuts={showHelp}>
              <Popover defaultOpen>
                <PopoverTrigger id="fixture-popover-trigger">
                  Inboxes
                </PopoverTrigger>
                <PopoverContent>Choose inboxes</PopoverContent>
              </Popover>
            </CommandPaletteProvider>
          </HotkeysProvider>
        );
      });
      await vi.waitFor(() => {
        expect(
          document.querySelector("#fixture-popover-trigger[data-popup-open]")
        ).not.toBeNull();
      });
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            ctrlKey: true,
            key: "K",
            shiftKey: true,
          })
        );
      });
      expect(document.querySelector("[role='combobox']")).toBeNull();
    } finally {
      act(() => {
        root.unmount();
      });
      container.remove();
    }
  });
});
