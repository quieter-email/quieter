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

const isAppShortcutSequenceContinuation = (
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

const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = getElementTarget(target);
  return !!element?.closest(editableSelector);
};

export const APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR =
  "[role='dialog'], [role='alertdialog'], [role='menu'][data-open], [data-popup-open][aria-haspopup], [data-popup-open][role='combobox']";

const hasOpenBlockingOverlay = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR
    ),
  ].some(
    (overlay) => !Object.hasOwn(overlay.dataset, "keyboardShortcutsDialog")
  );

const sequenceContinuationEvents = new WeakSet<KeyboardEvent>();

const recordContinuation = (event: KeyboardEvent) => {
  if (isAppShortcutSequenceContinuation(event)) {
    sequenceContinuationEvents.add(event);
  }
};

/**
 * Snapshots sequence progress before any hotkey manager handles the event.
 *
 * The hotkey and sequence managers each listen on `document`, so whichever
 * attached first runs first. When the sequence manager wins, it completes and
 * resets `G I` before the single-key `I` handler can see the partial match.
 * A window capture listener always runs before both.
 */
export const trackAppShortcutSequenceContinuations = () => {
  window.addEventListener("keydown", recordContinuation, { capture: true });
  return () => {
    window.removeEventListener("keydown", recordContinuation, {
      capture: true,
    });
  };
};

export const shouldIgnoreAppShortcut = (event: KeyboardEvent) =>
  isEditableShortcutTarget(event.target) ||
  hasOpenBlockingOverlay() ||
  sequenceContinuationEvents.has(event) ||
  isAppShortcutSequenceContinuation(event);
