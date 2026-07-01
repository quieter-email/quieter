import { describe, expect, test } from "bun:test";
import { KEYBOARD_SHORTCUT_CATEGORIES, KEYBOARD_SHORTCUTS } from "./keyboard-shortcuts";

const bindingKey = (key: unknown) => (typeof key === "string" ? key : JSON.stringify(key));

describe("keyboard shortcuts registry", () => {
  test("uses unique ids", () => {
    const ids = KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("does not duplicate active bindings within a scope", () => {
    const bindings = KEYBOARD_SHORTCUTS.flatMap((shortcut) => {
      if (shortcut.status === "coming-soon") return [];

      const keys = shortcut.sequence
        ? [shortcut.sequence.map(bindingKey).join(" ")]
        : shortcut.keys.map(bindingKey);
      return keys.map((key) => `${shortcut.scope}:${key}`);
    });

    expect(new Set(bindings).size).toBe(bindings.length);
  });

  test("has at least one shortcut in every displayed category", () => {
    const categories = new Set(KEYBOARD_SHORTCUTS.map((shortcut) => shortcut.category));

    for (const category of KEYBOARD_SHORTCUT_CATEGORIES) {
      expect(categories.has(category)).toBe(true);
    }
  });
});
