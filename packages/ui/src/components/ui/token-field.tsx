"use client";

import type { ClipboardEvent, KeyboardEvent, Ref, SyntheticEvent } from "react";
import { useEffect, useId, useImperativeHandle, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import {
  menuEmptyClassName,
  menuItemClassName,
  menuListPaddingClassName,
} from "./menu-chrome";
import { pillVariants } from "./pill";
import { popupSurfaceClassName } from "./popup-surface";
import {
  indexEditable,
  placeSelection,
  readRenderedTokenIds,
  readSelectionRange,
  renderSegments,
  stripAnchors,
} from "./token-field-dom";
import {
  applyTokenFieldToken,
  filterTokenFieldTokens,
  getTokenEndingAt,
  getTokenFieldQuery,
  parseTokenFieldSegments,
} from "./token-field-value";
import type { TokenFieldQuery, TokenFieldToken } from "./token-field-value";

export type { TokenFieldToken } from "./token-field-value";

type TokenFieldSelection = { end: number; start: number };

export type TokenFieldHandle = {
  focus: () => void;
  replaceRange: (range: TokenFieldSelection, replacement: string) => void;
};

type TokenFieldProps = {
  "aria-activedescendant"?: string;
  "aria-controls"?: string;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  onBlur?: () => void;
  onChange: (value: string, selection?: TokenFieldSelection) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onSelect?: (selection: TokenFieldSelection) => void;
  placeholder?: string;
  ref?: Ref<TokenFieldHandle>;
  size?: "composer" | "default" | "prompt";
  suggestionsLabel?: string;
  suggestionsSide?: "bottom" | "top";
  tokens: TokenFieldToken[];
  trigger?: string | null;
  value: string;
};

const getTokenClassName = (token: TokenFieldToken) =>
  cn(
    pillVariants({ tone: token.tone ?? "purple" }),
    // Tighter than a standalone pill: this one sits inline in a line of text.
    "mx-px max-w-full gap-1 px-2 py-0.5 align-middle select-none"
  );

const getTokenSignature = (tokens: TokenFieldToken[]) =>
  JSON.stringify(
    tokens.map((token) => [
      token.text,
      token.label,
      token.match,
      token.tone,
      token.iconSrc,
      token.iconClassName,
    ])
  );

const CARET_MOVE_KEYS = new Set([
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "End",
  "Home",
]);

const getSegmentTokenIds = (value: string, tokens: TokenFieldToken[]) =>
  parseTokenFieldSegments(value, tokens)
    .filter((segment) => segment.type === "token")
    .map((segment) => segment.text)
    .join("\0");

const TokenFieldSuggestions = ({
  activeIndex,
  emptyMessage,
  label,
  listId,
  onSelect,
  optionId,
  side,
  tokens,
}: {
  activeIndex: number;
  emptyMessage: string;
  label: string;
  listId: string;
  onSelect: (token: TokenFieldToken) => void;
  optionId: (position: number) => string;
  side: "bottom" | "top";
  tokens: TokenFieldToken[];
}) => (
  <div
    aria-label={label}
    className={cn(
      popupSurfaceClassName,
      "absolute right-0 left-0 z-50 max-h-56 overflow-y-auto overscroll-contain rounded-xl squircle",
      menuListPaddingClassName,
      { "bottom-full mb-1": side === "top", "top-full mt-1": !(side === "top") }
    )}
    id={listId}
    role="listbox"
  >
    {tokens.length === 0 ? (
      <p className={menuEmptyClassName}>{emptyMessage}</p>
    ) : (
      tokens.map((token, position) => (
        <button
          aria-selected={position === activeIndex}
          className={cn(menuItemClassName, "w-full")}
          data-highlighted={position === activeIndex ? "" : undefined}
          id={optionId(position)}
          key={token.id}
          onClick={() => {
            onSelect(token);
          }}
          // Selecting must not move focus out of the editable area.
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          role="option"
          tabIndex={-1}
          type="button"
        >
          {token.iconSrc === undefined ? null : (
            <img
              alt=""
              aria-hidden
              className={token.iconClassName ?? "size-4"}
              src={token.iconSrc}
            />
          )}
          <span className="min-w-0 flex-1 truncate">{token.label}</span>
          {token.description === undefined ? null : (
            <span className="shrink-0 text-caption text-muted-fg">
              {token.description}
            </span>
          )}
        </button>
      ))
    )}
  </div>
);

/**
 * A plain-text field that renders known mentions as inline tokens. The value
 * keeps the exact token text alongside ordinary text for storage and sending.
 */
export const TokenField = ({
  "aria-activedescendant": activeDescendant,
  "aria-controls": controls,
  "aria-label": ariaLabel,
  className,
  disabled = false,
  emptyMessage = "No matches",
  onBlur,
  onChange,
  onKeyDown,
  onSelect,
  placeholder,
  ref,
  size = "default",
  suggestionsLabel = "Mentions",
  suggestionsSide = "bottom",
  tokens,
  trigger = "@",
  value,
}: TokenFieldProps) => {
  const editableRef = useRef<HTMLDivElement>(null);
  // Null means nothing has been rendered yet, so the first sync always runs.
  const renderedValueRef = useRef<string | null>(null);
  const renderedTokensRef = useRef<string | null>(null);
  const composingRef = useRef(false);
  const [query, setQuery] = useState<TokenFieldQuery | undefined>();
  const [activeIndex, setActiveIndex] = useState(0);

  const fieldId = useId();
  const listId = `${fieldId}-suggestions`;
  const optionId = (position: number) => `${fieldId}-option-${position}`;

  const suggestions =
    query === undefined ? [] : filterTokenFieldTokens(tokens, query.query);
  const isOpen = query !== undefined && !disabled;
  const tokenSignature = getTokenSignature(tokens);

  useEffect(() => {
    const editable = editableRef.current;

    if (
      editable === null ||
      (renderedValueRef.current === value &&
        renderedTokensRef.current === tokenSignature)
    ) {
      return;
    }

    const isFocused = editable.ownerDocument.activeElement === editable;
    const selection = isFocused
      ? readSelectionRange(editable, indexEditable(editable))
      : undefined;

    renderSegments({
      getTokenClassName,
      root: editable,
      segments: parseTokenFieldSegments(value, tokens),
    });
    renderedValueRef.current = value;
    renderedTokensRef.current = tokenSignature;

    if (selection !== undefined) {
      placeSelection(editable, selection.start, selection.end);
    }
  }, [tokenSignature, tokens, value]);

  const commit = (nextValue: string, caret: number) => {
    const editable = editableRef.current;

    if (editable === null) {
      return;
    }

    renderSegments({
      getTokenClassName,
      root: editable,
      segments: parseTokenFieldSegments(nextValue, tokens),
    });
    placeSelection(editable, caret);
    const selection = editable.ownerDocument.getSelection();
    if (selection?.rangeCount === 1) {
      const caretRect = selection.getRangeAt(0).getBoundingClientRect();
      const bounds = editable.getBoundingClientRect();
      if (caretRect.height > 0) {
        if (caretRect.bottom > bounds.bottom) {
          editable.scrollTop += caretRect.bottom - bounds.bottom;
        } else if (caretRect.top < bounds.top) {
          editable.scrollTop -= bounds.top - caretRect.top;
        }
      }
    }
    renderedValueRef.current = nextValue;
    renderedTokensRef.current = tokenSignature;
    setQuery(undefined);
    onChange(nextValue, { end: caret, start: caret });
  };

  useImperativeHandle(ref, () => ({
    focus: () => editableRef.current?.focus(),
    replaceRange: ({ end, start }, replacement) => {
      editableRef.current?.focus();
      const prefix = value.slice(0, start);
      commit(
        `${prefix}${replacement}${value.slice(end)}`,
        prefix.length + replacement.length
      );
    },
  }));

  const selectToken = (token: TokenFieldToken) => {
    if (query === undefined) {
      return;
    }

    const next = applyTokenFieldToken({ query, token, value });
    commit(next.value, next.caret);
  };

  // Reopens the list when the caret is moved back into an unfinished mention,
  // without touching the value or the rendered content.
  const syncQuery = () => {
    const editable = editableRef.current;

    if (editable === null || trigger === null) {
      return;
    }

    const index = indexEditable(editable);
    const caret = readSelectionRange(editable, index)?.start;

    setQuery(
      caret === undefined
        ? undefined
        : getTokenFieldQuery({ caret, tokens, trigger, value: index.value })
    );
    setActiveIndex(0);
  };

  const handleInput = () => {
    const editable = editableRef.current;

    if (editable === null || composingRef.current) {
      return;
    }

    const index = indexEditable(editable);
    const nextValue = index.value;
    const selection = readSelectionRange(editable, index);
    const caret = selection?.start;

    if (
      getSegmentTokenIds(nextValue, tokens) !== readRenderedTokenIds(editable)
    ) {
      renderSegments({
        getTokenClassName,
        root: editable,
        segments: parseTokenFieldSegments(nextValue, tokens),
      });

      if (selection !== undefined) {
        placeSelection(editable, selection.start, selection.end);
      }
    }

    renderedValueRef.current = nextValue;
    renderedTokensRef.current = tokenSignature;
    setQuery(
      caret === undefined || trigger === null
        ? undefined
        : getTokenFieldQuery({ caret, tokens, trigger, value: nextValue })
    );
    setActiveIndex(0);
    onChange(nextValue, selection);
  };

  const handleSuggestionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      setQuery(undefined);
      return true;
    }

    if (suggestions.length === 0) {
      return false;
    }

    if (event.key === "ArrowDown") {
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return true;
    }

    if (event.key === "ArrowUp") {
      setActiveIndex(
        (current) => (current - 1 + suggestions.length) % suggestions.length
      );
      return true;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const token = suggestions[activeIndex];

      if (token !== undefined) {
        selectToken(token);
      }
      return true;
    }

    return false;
  };

  const handleBackspace = (event: KeyboardEvent<HTMLDivElement>) => {
    const editable = editableRef.current;

    if (editable === null) {
      return;
    }

    const index = indexEditable(editable);
    const range = readSelectionRange(editable, index);

    if (range === undefined || range.start !== range.end || range.start === 0) {
      return;
    }

    const token = getTokenEndingAt({
      caret: range.start,
      tokens,
      value: index.value,
    });

    if (token === undefined) {
      return;
    }

    event.preventDefault();
    commit(
      `${index.value.slice(0, token.start)}${index.value.slice(token.end)}`,
      token.start
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Safari may clear isComposing before the IME confirmation key event.
    // oxlint-disable-next-line typescript/no-deprecated
    if (event.nativeEvent.isComposing || event.keyCode === 229) {
      return;
    }
    if (
      (event.metaKey || event.ctrlKey) &&
      ["b", "i", "u"].includes(event.key.toLowerCase())
    ) {
      event.preventDefault();
      return;
    }
    if (isOpen && handleSuggestionKeyDown(event)) {
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace") {
      handleBackspace(event);

      if (event.defaultPrevented) {
        return;
      }
    }

    onKeyDown?.(event);
  };

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>) => {
    const editable = editableRef.current;

    if (editable === null) {
      return;
    }

    event.preventDefault();
    const text = stripAnchors(
      event.clipboardData.getData("text/plain")
    ).replaceAll(/\r\n?/gu, "\n");
    const index = indexEditable(editable);
    const range = readSelectionRange(editable, index) ?? {
      end: index.value.length,
      start: index.value.length,
    };

    commit(
      `${index.value.slice(0, range.start)}${text}${index.value.slice(range.end)}`,
      range.start + text.length
    );
  };

  const handleCopyOrCut = (event: ClipboardEvent<HTMLDivElement>) => {
    const root = event.currentTarget;
    const index = indexEditable(root);
    const range = readSelectionRange(root, index);
    if (range === undefined || range.start === range.end) {
      return;
    }
    event.preventDefault();
    event.clipboardData.setData(
      "text/plain",
      index.value.slice(range.start, range.end)
    );
    if (event.type === "cut") {
      commit(
        index.value.slice(0, range.start) + index.value.slice(range.end),
        range.start
      );
    }
  };

  const reportSelection = ({
    currentTarget,
  }: SyntheticEvent<HTMLDivElement>) => {
    if (onSelect !== undefined && !composingRef.current) {
      const range = readSelectionRange(
        currentTarget,
        indexEditable(currentTarget)
      );
      if (range !== undefined) {
        onSelect(range);
      }
    }
  };

  return (
    <div className="relative">
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- The editor has a textbox or combobox role depending on its suggestion source. */}
      <div
        aria-activedescendant={
          isOpen && suggestions[activeIndex] !== undefined
            ? optionId(activeIndex)
            : activeDescendant
        }
        aria-autocomplete="list"
        aria-controls={isOpen ? listId : controls}
        aria-disabled={disabled || undefined}
        aria-expanded={trigger === null ? undefined : isOpen}
        aria-label={ariaLabel}
        aria-multiline={trigger === null ? true : undefined}
        className={cn(
          "w-full break-words whitespace-pre-wrap text-fg outline-none",
          "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-muted-fg data-[empty=true]:before:content-[attr(data-placeholder)]",
          {
            "cursor-not-allowed opacity-50": disabled,
            "max-h-40 min-h-16 overflow-y-auto py-2 text-body-sm":
              size === "composer",
            "max-h-72 min-h-32 overflow-y-auto": size === "prompt",
          },
          className
        )}
        contentEditable={!disabled}
        data-empty={value === "" ? "true" : "false"}
        data-placeholder={placeholder}
        data-slot="token-field-input"
        onBlur={() => {
          setQuery(undefined);
          onBlur?.();
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
          handleInput();
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCopy={handleCopyOrCut}
        onCut={handleCopyOrCut}
        onDrop={(event) => {
          event.preventDefault();
        }}
        onClick={syncQuery}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (!isOpen && CARET_MOVE_KEYS.has(event.key)) {
            syncQuery();
          }
        }}
        onPaste={handlePaste}
        onFocus={reportSelection}
        onSelect={reportSelection}
        ref={editableRef}
        role={trigger === null ? "textbox" : "combobox"}
        suppressContentEditableWarning
        tabIndex={disabled ? -1 : 0}
      />

      {isOpen ? (
        <TokenFieldSuggestions
          activeIndex={activeIndex}
          emptyMessage={emptyMessage}
          label={suggestionsLabel}
          listId={listId}
          onSelect={selectToken}
          optionId={optionId}
          side={suggestionsSide}
          tokens={suggestions}
        />
      ) : null}
    </div>
  );
};
