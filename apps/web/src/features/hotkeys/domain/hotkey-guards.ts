import {
  DEFAULT_SEQUENCE_TIMEOUT,
  getSequenceManager,
  matchesKeyboardEvent,
} from "@tanstack/hotkeys";

const editableSelector = [
  "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='reset']):not([type='submit'])",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(",");

const getElementTarget = (target: EventTarget | null) =>
  target instanceof Element ? target : null;

export const isAppShortcutSequenceContinuation = (event: KeyboardEvent, now = Date.now()) => {
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
    "[role='dialog']:not([data-keyboard-shortcuts-dialog]), [data-popup-open]:not([data-keyboard-shortcuts-dialog])",
  );

export const shouldIgnoreAppShortcut = (event: KeyboardEvent) =>
  isEditableShortcutTarget(event.target) ||
  hasOpenBlockingDialog() ||
  isAppShortcutSequenceContinuation(event);
