// @vitest-environment jsdom
import { shouldIgnoreAppShortcut } from "@quieter/app/features/hotkeys/domain/hotkey-guards";
import { useHotkey } from "@tanstack/react-hotkeys";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it } from "vite-plus/test";

const fired: string[] = [];

const SingleKey = () => {
  useHotkey(
    "I",
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        fired.push("single");
      }
    },
    { ignoreInputs: true }
  );
  return null;
};

const GoSequence = () => {
  useHotkey(
    ["G", "I"],
    (event) => {
      if (!shouldIgnoreAppShortcut(event)) {
        fired.push("sequence");
      }
    },
    { ignoreInputs: true }
  );
  return null;
};

const press = (key: string) => {
  for (const type of ["keydown", "keyup"]) {
    document.body.dispatchEvent(
      new KeyboardEvent(type, {
        bubbles: true,
        code: `Key${key}`,
        key: key.toLowerCase(),
      })
    );
  }
};

describe("app shortcut sequence guard", () => {
  beforeEach(() => {
    fired.length = 0;
  });

  it.each([
    ["single key registered first", [SingleKey, GoSequence]],
    ["sequence registered first", [GoSequence, SingleKey]],
  ])(
    "keeps a sequence's final key away from the matching single-key shortcut (%s)",
    (_order, components) => {
      const host = document.createElement("div");
      document.body.append(host);
      const root = createRoot(host);
      act(() => {
        root.render(
          <>
            {components.map((Component) => (
              <Component key={Component.name} />
            ))}
          </>
        );
      });

      press("G");
      press("I");
      press("I");

      expect(fired).toStrictEqual(["sequence", "single"]);
      root.unmount();
      host.remove();
    }
  );
});
