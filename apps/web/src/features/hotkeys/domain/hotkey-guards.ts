import {
  DEFAULT_SEQUENCE_TIMEOUT,
  getSequenceManager,
  matchesKeyboardEvent,
} from "@tanstack/hotkeys";
import type { UseHotkeyDefinition } from "@tanstack/react-hotkeys";

/**
 * Drops disabled definitions so an inactive context registers nothing.
 *
 * `useHotkeys` keeps `enabled: false` rows registered and only suppresses their
 * callbacks, so two mounted contexts declaring the same key always collide in
 * `HotkeyManager` and warn. Filtering first keeps registration itself scoped to
 * whichever context is currently active.
 */
export const omitDisabledHotkeys = (definitions: UseHotkeyDefinition[]) =>
  definitions.filter((definition) => definition.options?.enabled !== false);

const editableSelector = [
  "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='reset']):not([type='submit'])",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(",");

const getElementTarget = (target: EventTarget | null) =>
  target instanceof Element ? target : null;

export const isAppShortcutSequenceContinuation = (
  event: KeyboardEvent,
  now = Date.now()
) => {
  for (const registration of getSequenceManager().registrations.state.values()) {
    const nextHotkey = registration.sequence[registration.matchedStepCount];
    if (
      registration.options.enabled !== false &&
      registration.matchedStepCount > 0 &&
      nextHotkey &&
      now - registration.partialMatchLastKeyTime <=
        (registration.options.timeout ?? DEFAULT_SEQUENCE_TIMEOUT) &&
      matchesKeyboardEvent(event, nextHotkey, registration.options.platform)
    ) {
      return true;
    }
  }

  return false;
};

export const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = getElementTarget(target);
  return !!element?.closest(editableSelector);
};

export const hasOpenBlockingDialog = () =>
  !!document.querySelector(
    "[role='dialog']:not([data-keyboard-shortcuts-dialog]), [data-popup-open]:not([data-keyboard-shortcuts-dialog])"
  );

export const shouldIgnoreAppShortcut = (event: KeyboardEvent) =>
  isEditableShortcutTarget(event.target) ||
  hasOpenBlockingDialog() ||
  isAppShortcutSequenceContinuation(event);
