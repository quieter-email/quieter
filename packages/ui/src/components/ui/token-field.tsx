"use client";

import type { ClipboardEvent, KeyboardEvent, Ref } from "react";
import { useEffect, useId, useRef, useState } from "react";

import { cn } from "../../lib/cn";
import { pillVariants } from "./pill";
import {
  indexEditable,
  placeCaret,
  readRenderedTokenIds,
  readSelectionRange,
  renderSegments,
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

type TokenFieldProps = {
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  emptyMessage?: string;
  onBlur?: () => void;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  placeholder?: string;
  ref?: Ref<HTMLDivElement>;
  suggestionsLabel?: string;
  suggestionsSide?: "bottom" | "top";
  tokens: TokenFieldToken[];
  trigger?: string;
  value: string;
};

const getTokenClassName = (token: TokenFieldToken) =>
  cn(
    pillVariants({ tone: token.tone ?? "purple" }),
    // Tighter than a standalone pill: this one sits inline in a line of text.
    "mx-px gap-1 px-2 py-0.5 align-middle select-none"
  );

const getTokenSignature = (tokens: TokenFieldToken[]) =>
  tokens.map((token) => token.text).join("\0");

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
      "squircle absolute right-0 left-0 z-50 max-h-56 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 text-popover-fg shadow-md",
      { "bottom-full mb-1": side === "top", "top-full mt-1": !(side === "top") }
    )}
    id={listId}
    role="listbox"
  >
    {tokens.length === 0 ? (
      <p className="px-2.5 py-2 text-body text-muted-fg">{emptyMessage}</p>
    ) : (
      tokens.map((token, position) => (
        <button
          aria-selected={position === activeIndex}
          className={cn(
            "squircle flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-body text-fg",
            { "bg-muted": position === activeIndex }
          )}
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
 * stays a string, so what the agent receives is exactly what is displayed.
 */
export const TokenField = ({
  "aria-label": ariaLabel,
  className,
  disabled = false,
  emptyMessage = "No matches",
  onBlur,
  onChange,
  onKeyDown,
  placeholder,
  ref,
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
    const caret = isFocused
      ? readSelectionRange(editable, indexEditable(editable))?.start
      : undefined;

    renderSegments({
      getTokenClassName,
      root: editable,
      segments: parseTokenFieldSegments(value, tokens),
    });
    renderedValueRef.current = value;
    renderedTokensRef.current = tokenSignature;

    if (caret !== undefined) {
      placeCaret(editable, caret);
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
    placeCaret(editable, caret);
    renderedValueRef.current = nextValue;
    renderedTokensRef.current = tokenSignature;
    setQuery(undefined);
    onChange(nextValue);
  };

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

    if (editable === null) {
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
    const caret = readSelectionRange(editable, index)?.start;

    if (
      getSegmentTokenIds(nextValue, tokens) !== readRenderedTokenIds(editable)
    ) {
      renderSegments({
        getTokenClassName,
        root: editable,
        segments: parseTokenFieldSegments(nextValue, tokens),
      });

      if (caret !== undefined) {
        placeCaret(editable, caret);
      }
    }

    renderedValueRef.current = nextValue;
    renderedTokensRef.current = tokenSignature;
    setQuery(
      caret === undefined
        ? undefined
        : getTokenFieldQuery({ caret, tokens, trigger, value: nextValue })
    );
    setActiveIndex(0);
    onChange(nextValue);
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
    const text = event.clipboardData.getData("text/plain");
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

  return (
    <div className="relative">
      <div
        aria-activedescendant={
          isOpen && suggestions[activeIndex] !== undefined
            ? optionId(activeIndex)
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={isOpen ? listId : undefined}
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        className={cn(
          "w-full break-words whitespace-pre-wrap text-fg outline-none",
          "data-[empty=true]:before:pointer-events-none data-[empty=true]:before:text-muted-fg data-[empty=true]:before:content-[attr(data-placeholder)]",
          { "cursor-not-allowed opacity-50": disabled },
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
        onClick={syncQuery}
        onInput={handleInput}
        onKeyDown={handleKeyDown}
        onKeyUp={(event) => {
          if (!isOpen && CARET_MOVE_KEYS.has(event.key)) {
            syncQuery();
          }
        }}
        onPaste={handlePaste}
        ref={(node) => {
          editableRef.current = node;

          if (typeof ref === "function") {
            ref(node);
          } else if (ref !== null && ref !== undefined) {
            ref.current = node;
          }
        }}
        role="combobox"
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
