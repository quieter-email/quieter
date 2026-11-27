"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import type { ComponentProps, RefObject } from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { FieldControl } from "./field";
import { Input } from "./input";
import {
  menuEmptyClassName,
  menuItemClassName,
  menuListPaddingClassName,
} from "./menu-chrome";
import { anchoredPopupMotionClassName } from "./overlay-chrome";
import { popupSideOffset, popupSurfaceClassName } from "./popup-surface";

const autocompletePopupClassName = `${anchoredPopupMotionClassName} ${popupSurfaceClassName} flex max-h-[min(16rem,var(--available-height))] w-80 max-w-(--available-width) flex-col overflow-hidden rounded-xl`;

const autocompleteListClassName = `min-h-0 overflow-y-auto overscroll-contain ${menuListPaddingClassName} empty:p-0`;

export type AutocompleteProps = Pick<
  ComponentProps<typeof Input>,
  | "aria-label"
  | "chrome"
  | "className"
  | "disabled"
  | "id"
  | "maxLength"
  | "name"
  | "placeholder"
  | "required"
  | "size"
> & {
  emptyMessage?: string;
  onValueChange: (value: string) => void;
  options: readonly string[];
  value: string;
};

export const Autocomplete = ({
  chrome,
  disabled,
  emptyMessage = "No suggestions. You can enter your own value.",
  onValueChange,
  options,
  size,
  value,
  ...props
}: AutocompleteProps) => (
  <AutocompletePrimitive.Root
    disabled={disabled}
    filter={(option, query) =>
      option.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    }
    items={options}
    onValueChange={onValueChange}
    openOnInputClick
    value={value}
  >
    <AutocompletePrimitive.Input
      render={<Input chrome={chrome} size={size} />}
      {...props}
    />
    <AutocompletePrimitive.Portal>
      <AutocompletePrimitive.Positioner
        align="start"
        className="isolate z-50"
        collisionPadding={8}
        sideOffset={popupSideOffset}
      >
        <AutocompletePrimitive.Popup
          className={cn(autocompletePopupClassName, "min-w-(--anchor-width)")}
        >
          <AutocompletePrimitive.Empty
            className={cn(menuEmptyClassName, "empty:p-0")}
          >
            {emptyMessage}
          </AutocompletePrimitive.Empty>
          <AutocompletePrimitive.List className={autocompleteListClassName}>
            {(option: string) => (
              <AutocompletePrimitive.Item
                className={menuItemClassName}
                key={option}
                value={option}
              >
                <span className="truncate">{option}</span>
              </AutocompletePrimitive.Item>
            )}
          </AutocompletePrimitive.List>
        </AutocompletePrimitive.Popup>
      </AutocompletePrimitive.Positioner>
    </AutocompletePrimitive.Portal>
  </AutocompletePrimitive.Root>
);

export type AutocompleteSuggestion = {
  description?: string;
  label: string;
  value: string;
};

type AutocompleteFieldProps = Omit<
  ComponentProps<typeof FieldControl>,
  "defaultValue" | "onChange" | "onSelect" | "onValueChange"
> & {
  inputRef?: RefObject<HTMLInputElement | null>;
  onCaretChange?: (caret: number | null) => void;
  onDismiss: () => void;
  /** Returns the caret position to restore in the completed value. */
  onSuggestionSelect: (value: string) => number;
  onValueChange: (
    value: string,
    change: { caret: number | null; typed: boolean }
  ) => void;
  open: boolean;
  suggestions: readonly AutocompleteSuggestion[];
  value: string;
};

/**
 * A field whose caller owns lookup and completes only part of the value, such
 * as one address in a list. Nothing is highlighted until the reader chooses.
 */
export const AutocompleteField = ({
  chrome,
  className,
  disabled,
  inputRef: providedInputRef,
  onCaretChange,
  onDismiss,
  onKeyDown,
  onSuggestionSelect,
  onValueChange,
  open,
  size,
  suggestions,
  value,
  ...props
}: AutocompleteFieldProps) => {
  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = providedInputRef ?? localInputRef;
  const pendingCaretRef = useRef<number | null>(null);
  const keyboardChoiceRef = useRef<string | undefined>(undefined);
  // Late results must not replace the option under a highlight.
  const [heldSuggestions, setHeldSuggestions] = useState<
    readonly AutocompleteSuggestion[] | null
  >(null);
  const isOpen = open && suggestions.length > 0 && disabled !== true;
  if (!isOpen && heldSuggestions) {
    setHeldSuggestions(null);
  }
  const options = heldSuggestions ?? suggestions;

  useLayoutEffect(() => {
    if (pendingCaretRef.current !== null) {
      inputRef.current?.setSelectionRange(
        pendingCaretRef.current,
        pendingCaretRef.current
      );
      pendingCaretRef.current = null;
    }
  }, [inputRef, value]);

  const select = (choice: string) => {
    keyboardChoiceRef.current = undefined;
    setHeldSuggestions(null);
    pendingCaretRef.current = onSuggestionSelect(choice);
    inputRef.current?.focus();
  };

  const dismiss = () => {
    keyboardChoiceRef.current = undefined;
    setHeldSuggestions(null);
    onDismiss();
  };

  return (
    <AutocompletePrimitive.Root
      disabled={disabled}
      filter={null}
      items={options.map((option) => option.value)}
      onItemHighlighted={(choice, details) => {
        keyboardChoiceRef.current =
          details.reason === "keyboard" ? choice : undefined;
        setHeldSuggestions(choice === undefined ? null : options);
      }}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          dismiss();
        }
      }}
      onValueChange={(nextValue, details) => {
        if (details.reason === "item-press") {
          details.cancel();
          select(nextValue);
        } else if (details.reason === "input-change") {
          keyboardChoiceRef.current = undefined;
          setHeldSuggestions(null);
          const { event } = details;
          onValueChange(nextValue, {
            caret: inputRef.current?.selectionStart ?? null,
            typed: !(
              event instanceof InputEvent &&
              (event.inputType === "insertFromPaste" ||
                event.inputType === "insertFromDrop")
            ),
          });
        } else {
          // Escape on a closed list would otherwise clear the whole field.
          details.cancel();
        }
      }}
      open={isOpen}
      value={value}
    >
      <AutocompletePrimitive.Input
        {...props}
        className={className}
        onKeyDown={(event) => {
          // Safari may clear isComposing before the IME confirmation key event.
          if (
            event.nativeEvent.isComposing ||
            // oxlint-disable-next-line typescript/no-deprecated
            event.keyCode === 229
          ) {
            return;
          }
          if (isOpen && event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            event.preventBaseUIHandler();
            dismiss();
            return;
          }
          if (
            isOpen &&
            heldSuggestions &&
            event.key === "Enter" &&
            !event.ctrlKey &&
            !event.metaKey
          ) {
            return;
          }
          const choice = keyboardChoiceRef.current;
          if (
            isOpen &&
            choice !== undefined &&
            options.some((option) => option.value === choice) &&
            ((event.key === "Tab" && !event.shiftKey) ||
              (event.key === "Enter" && (event.ctrlKey || event.metaKey)))
          ) {
            event.preventDefault();
            event.stopPropagation();
            event.preventBaseUIHandler();
            select(choice);
            return;
          }
          onKeyDown?.(event);
          if (event.defaultPrevented) {
            event.preventBaseUIHandler();
          }
        }}
        onSelect={(event) => {
          const { selectionEnd, selectionStart } = event.currentTarget;
          onCaretChange?.(
            selectionStart === selectionEnd ? selectionStart : null
          );
        }}
        ref={inputRef}
        render={<FieldControl chrome={chrome} size={size} />}
      />
      <AutocompletePrimitive.Status className="sr-only">
        {isOpen
          ? `${options.length} ${options.length === 1 ? "suggestion" : "suggestions"}`
          : null}
      </AutocompletePrimitive.Status>
      <AutocompletePrimitive.Portal>
        <AutocompletePrimitive.Positioner
          align="start"
          className="isolate z-50"
          collisionPadding={8}
          sideOffset={popupSideOffset}
        >
          <AutocompletePrimitive.Popup className={autocompletePopupClassName}>
            <AutocompletePrimitive.List className={autocompleteListClassName}>
              {options.map((option) => (
                <AutocompletePrimitive.Item
                  className={cn(
                    menuItemClassName,
                    "flex-col items-stretch justify-center gap-0"
                  )}
                  key={option.value}
                  value={option.value}
                >
                  <span className="truncate" dir="auto">
                    {option.label}
                  </span>
                  {option.description === undefined ? null : (
                    <span className="text-caption wrap-anywhere text-muted-fg">
                      {option.description}
                    </span>
                  )}
                </AutocompletePrimitive.Item>
              ))}
            </AutocompletePrimitive.List>
          </AutocompletePrimitive.Popup>
        </AutocompletePrimitive.Positioner>
      </AutocompletePrimitive.Portal>
    </AutocompletePrimitive.Root>
  );
};
