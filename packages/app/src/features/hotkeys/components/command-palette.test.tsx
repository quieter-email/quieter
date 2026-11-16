// @vitest-environment jsdom
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
});
