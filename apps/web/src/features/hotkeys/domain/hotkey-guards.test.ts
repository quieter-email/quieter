import { getSequenceManager } from "@tanstack/hotkeys";
import type {
  RegisterableHotkey,
  SequenceRegistrationView,
} from "@tanstack/hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { afterEach, describe, expect, test } from "vite-plus/test";

import {
  isAppShortcutSequenceContinuation,
  omitDisabledHotkeys,
} from "./hotkey-guards";

const keyboardEvent = (key: string) => {
  const event = Object.assign(new Event("keydown"), {
    altKey: false,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
  });

  // Node tests do not provide a browser KeyboardEvent implementation.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return event as KeyboardEvent;
};

// The registration target is not inspected by the guard under test.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const testTarget = Object.create(null) as HTMLElement;

const setSequenceProgress = (partialMatchLastKeyTime: number) => {
  const registration = {
    hasFired: false,
    id: "go-archive",
    matchedStepCount: 1,
    options: { enabled: true, platform: "windows", timeout: 1000 },
    partialMatchLastKeyTime,
    sequence: ["G", "A"],
    target: testTarget,
    triggerCount: 0,
  } satisfies SequenceRegistrationView;

  getSequenceManager().registrations.setState(
    () => new Map([[registration.id, registration]])
  );
};

describe("app shortcut sequence tracking", () => {
  afterEach(() => {
    getSequenceManager().registrations.setState(() => new Map());
  });

  test("marks the second key of a mailbox navigation sequence", () => {
    setSequenceProgress(1000);

    expect(
      isAppShortcutSequenceContinuation(keyboardEvent("a"), 1500)
    ).toBeTruthy();
  });

  test("does not suppress a standalone action after the sequence timeout", () => {
    setSequenceProgress(1000);

    expect(
      isAppShortcutSequenceContinuation(keyboardEvent("a"), 2001)
    ).toBeFalsy();
  });

  test("does not suppress keys that do not complete a navigation sequence", () => {
    setSequenceProgress(1000);

    expect(
      isAppShortcutSequenceContinuation(keyboardEvent("c"), 1500)
    ).toBeFalsy();
  });
});

const hotkeyDefinition = (
  hotkey: RegisterableHotkey,
  enabled?: boolean
): UseHotkeyDefinition => ({
  callback: () => {
    // Registration scoping is the behavior under test, not the callback.
  },
  hotkey,
  ...(enabled === undefined ? {} : { options: { enabled } }),
});

describe("hotkey registration scoping", () => {
  test("keeps the active context so only it registers a shared key", () => {
    expect(
      omitDisabledHotkeys([
        hotkeyDefinition("E", false),
        hotkeyDefinition("Shift+3", false),
      ])
    ).toStrictEqual([]);
    expect(omitDisabledHotkeys([hotkeyDefinition("E", true)])).toHaveLength(1);
  });

  test("treats an omitted enabled flag as registerable", () => {
    expect(omitDisabledHotkeys([hotkeyDefinition("R")])).toHaveLength(1);
  });
});
