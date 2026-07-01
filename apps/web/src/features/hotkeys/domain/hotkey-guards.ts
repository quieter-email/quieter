const editableSelector = [
  "input:not([type='button']):not([type='checkbox']):not([type='radio']):not([type='reset']):not([type='submit'])",
  "textarea",
  "select",
  "[contenteditable='']",
  "[contenteditable='true']",
].join(",");

const getElementTarget = (target: EventTarget | null) =>
  target instanceof Element ? target : null;

export const isEditableShortcutTarget = (target: EventTarget | null) => {
  const element = getElementTarget(target);
  return !!element?.closest(editableSelector);
};

export const hasOpenBlockingDialog = () =>
  !!document.querySelector(
    "[role='dialog']:not([data-keyboard-shortcuts-dialog]), [data-popup-open]:not([data-keyboard-shortcuts-dialog])",
  );

export const shouldIgnoreAppShortcut = (event: KeyboardEvent) =>
  isEditableShortcutTarget(event.target) || hasOpenBlockingDialog();
