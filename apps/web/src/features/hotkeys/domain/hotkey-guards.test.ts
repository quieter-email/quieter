import { getSequenceManager, type SequenceRegistrationView } from "@tanstack/hotkeys";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { isAppShortcutSequenceContinuation } from "./hotkey-guards";

const keyboardEvent = (key: string) =>
  ({ altKey: false, ctrlKey: false, key, metaKey: false, shiftKey: false }) as KeyboardEvent;

const setSequenceProgress = (partialMatchLastKeyTime: number) => {
  const registration = {
    hasFired: false,
    id: "go-archive",
    matchedStepCount: 1,
    options: { enabled: true, platform: "windows", timeout: 1_000 },
    partialMatchLastKeyTime,
    sequence: ["G", "A"],
    target: {} as Document,
    triggerCount: 0,
  } satisfies SequenceRegistrationView;

  getSequenceManager().registrations.setState(() => new Map([[registration.id, registration]]));
};

describe("app shortcut sequence tracking", () => {
  afterEach(() => getSequenceManager().registrations.setState(() => new Map()));

  test("marks the second key of a mailbox navigation sequence", () => {
    setSequenceProgress(1_000);

    expect(isAppShortcutSequenceContinuation(keyboardEvent("a"), 1_500)).toBe(true);
  });

  test("does not suppress a standalone action after the sequence timeout", () => {
    setSequenceProgress(1_000);

    expect(isAppShortcutSequenceContinuation(keyboardEvent("a"), 2_001)).toBe(false);
  });

  test("does not suppress keys that do not complete a navigation sequence", () => {
    setSequenceProgress(1_000);

    expect(isAppShortcutSequenceContinuation(keyboardEvent("c"), 1_500)).toBe(false);
  });
});
