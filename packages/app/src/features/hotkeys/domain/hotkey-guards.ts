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

const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = getElementTarget(target);
  return !!element?.closest(editableSelector);
};

export const APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR =
  "[role='dialog'], [role='alertdialog'], [role='menu'][data-open], [data-popover-popup][data-open], [data-blocking-overlay], [data-popup-open][aria-haspopup], [data-popup-open][role='combobox']";

const hasOpenBlockingOverlay = () =>
  [
    ...document.querySelectorAll<HTMLElement>(
      APP_SHORTCUT_BLOCKING_OVERLAY_SELECTOR
    ),
  ].some(
    (overlay) => !Object.hasOwn(overlay.dataset, "keyboardShortcutsDialog")
  );

export const shouldIgnoreAppShortcut = (event: KeyboardEvent) =>
  isEditableShortcutTarget(event.target) || hasOpenBlockingOverlay();
