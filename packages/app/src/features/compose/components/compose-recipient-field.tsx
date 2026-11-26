"use client";

import type { ComposeDialogController } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import {
  extractMailAddress,
  findInvalidMailAddresses,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { parseSender } from "@quieter/mail/thread-list";
import { AutocompleteField } from "@quieter/ui/autocomplete";
import {
  ComposerContextChip,
  ComposerFieldRow,
  ComposerInputGroup,
} from "@quieter/ui/composer-chrome";
import type { ComponentProps, ReactNode } from "react";
import { useRef, useState } from "react";

import {
  applyRecipientCompletion,
  filterRecipientSuggestions,
  getRecipientCompletion,
} from "../domain/recipient-completion";
import type { RecipientCompletion } from "../domain/recipient-completion";
import { useRecipientSuggestions } from "./use-recipient-suggestions";
import type { RecipientSuggestionScope } from "./use-recipient-suggestions";

type RecipientFieldName = "bcc" | "cc" | "to";

const recipientFieldNames = ["to", "cc", "bcc"] as const;

const RecipientInput = ({
  onValueChange,
  otherFields,
  suggestionScope,
  value,
  ...props
}: Pick<
  ComponentProps<typeof AutocompleteField>,
  "aria-invalid" | "disabled" | "onBlur" | "placeholder" | "value"
> & {
  onValueChange: (value: string) => void;
  otherFields: readonly string[];
  suggestionScope: RecipientSuggestionScope | null;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{
    input: string;
    value: string;
  } | null>(null);
  const [active, setActive] = useState<{
    completion: RecipientCompletion;
    scopeId: string;
    value: string;
  } | null>(null);
  const entries = splitMailAddressList(value);
  const lastEntry = entries.at(-1) ?? "";
  const savedInput =
    findInvalidMailAddresses(lastEntry).length > 0 ? lastEntry : "";
  const input = editing?.value === value ? editing.input : savedInput;
  const recipients = input.trim() ? entries.slice(0, -1) : entries;
  // A value or scope that changed underneath the caret closes the list.
  const completion =
    active &&
    active.scopeId === suggestionScope?.id &&
    active.value === value &&
    props.disabled !== true
      ? active.completion
      : null;
  const loaded = useRecipientSuggestions(suggestionScope, completion);
  const suggestions = completion
    ? filterRecipientSuggestions({
        completion,
        otherFields: [...recipients, ...otherFields],
        suggestions: loaded,
        value: input,
      })
    : [];
  const dismiss = () => {
    setActive(null);
  };
  const update = (nextRecipients: string[], nextInput: string) => {
    const pending = nextInput.trim();
    const nextValue = (
      pending ? [...nextRecipients, pending] : nextRecipients
    ).join(", ");
    setEditing({ input: nextInput, value: nextValue });
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
    return nextValue;
  };
  const removeRecipient = (index: number) => {
    dismiss();
    inputRef.current?.focus();
    update(
      recipients.filter((_, recipientIndex) => recipientIndex !== index),
      input
    );
  };
  const commitInput = () => {
    const pending = splitMailAddressList(input);
    if (pending.length === 0 || findInvalidMailAddresses(input).length > 0) {
      return false;
    }
    update([...recipients, ...pending], "");
    return true;
  };

  return (
    <ComposerInputGroup>
      {recipients.map((recipient, index) => {
        const invalid = findInvalidMailAddresses(recipient).length > 0;
        const address = invalid ? recipient : extractMailAddress(recipient);
        const name = address === recipient ? "" : parseSender(recipient).name;
        return (
          <ComposerContextChip
            description={name ? address : undefined}
            disabled={props.disabled}
            invalid={invalid}
            // Older drafts can contain duplicate addresses.
            // oxlint-disable-next-line react/no-array-index-key
            key={`${recipient}-${index}`}
            label={name || address}
            onRemove={() => {
              removeRecipient(index);
            }}
            surface="field"
          />
        );
      })}
      <AutocompleteField
        {...props}
        chrome="composer-token"
        inputRef={inputRef}
        onBlur={(event) => {
          dismiss();
          commitInput();
          props.onBlur?.(event);
        }}
        onCaretChange={(caret) => {
          if (
            active &&
            (caret === null ||
              caret <= active.completion.start ||
              caret > active.completion.end)
          ) {
            dismiss();
          }
        }}
        onDismiss={dismiss}
        onFocus={() => {
          suggestionScope?.warm();
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            dismiss();
            commitInput();
          } else if (
            event.key === "Backspace" &&
            !input &&
            recipients.length > 0
          ) {
            event.preventDefault();
            removeRecipient(recipients.length - 1);
          }
        }}
        onPaste={(event) => {
          const { selectionEnd, selectionStart } = event.currentTarget;
          const pasted = `${input.slice(0, selectionStart ?? 0)}${event.clipboardData.getData("text/plain")}${input.slice(selectionEnd ?? input.length)}`;
          const addresses = splitMailAddressList(pasted);
          const last = addresses.at(-1);
          if (last === undefined) {
            return;
          }
          const pending = findInvalidMailAddresses(last).length > 0;
          if (pending && addresses.length === 1) {
            return;
          }
          event.preventDefault();
          dismiss();
          if (pending) {
            addresses.pop();
          }
          update([...recipients, ...addresses], pending ? last : "");
        }}
        onSuggestionSelect={(email) => {
          if (completion) {
            const next = applyRecipientCompletion(input, completion, email);
            dismiss();
            update([...recipients, ...splitMailAddressList(next.value)], "");
            return 0;
          }
          return input.length;
        }}
        onValueChange={(nextValue, { caret, typed }) => {
          if (
            typed &&
            caret === nextValue.length &&
            nextValue === `${input} ` &&
            commitInput()
          ) {
            dismiss();
            return;
          }
          // Keep the final fragment editable while splitting delimiters outside quoted addresses.
          const parts = splitMailAddressList(`${nextValue}x`);
          const tail = parts.pop()?.slice(0, -1) ?? "";
          let nextInput = tail === nextValue.trimStart() ? nextValue : tail;
          const last = parts.at(-1);
          if (!tail && last && findInvalidMailAddresses(last).length > 0) {
            parts.pop();
            nextInput = last;
          }
          const nextFieldValue = update([...recipients, ...parts], nextInput);
          const nextCompletion =
            typed &&
            caret !== null &&
            nextInput === nextValue &&
            suggestionScope
              ? getRecipientCompletion(nextInput, caret)
              : null;
          if (nextCompletion) {
            suggestionScope?.warm();
          }
          setActive(
            nextCompletion && suggestionScope
              ? {
                  completion: nextCompletion,
                  scopeId: suggestionScope.id,
                  value: nextFieldValue,
                }
              : null
          );
        }}
        open={completion !== null}
        spellCheck={false}
        suggestions={suggestions.map(({ email, name }) =>
          name?.trim()
            ? { description: email, label: name, value: email }
            : { label: email, value: email }
        )}
        value={input}
      />
    </ComposerInputGroup>
  );
};

export const ComposeRecipientField = ({
  disabled,
  form,
  handleUserDraftChange,
  label,
  name,
  placeholder,
  suggestionScope,
  trailing,
  ...inputProps
}: Pick<ComposeDialogController, "form" | "handleUserDraftChange"> & {
  "data-compose-recipient-field"?: boolean;
  disabled?: boolean;
  label: string;
  name: RecipientFieldName;
  placeholder?: string;
  suggestionScope: RecipientSuggestionScope | null;
  trailing?: ReactNode;
}) => (
  <form.Field name={name}>
    {(field) => {
      const [error] = field.state.meta.errors;
      return (
        <ComposerFieldRow
          error={error ? (error.message ?? "Invalid value") : undefined}
          label={label}
          trailing={trailing}
        >
          <form.Subscribe
            selector={({ values }) =>
              recipientFieldNames
                .filter((fieldName) => fieldName !== name)
                .map((fieldName) => values[fieldName])
            }
          >
            {(otherFields) => (
              <RecipientInput
                {...inputProps}
                aria-invalid={!!error}
                disabled={disabled}
                onBlur={() => {
                  field.handleBlur();
                }}
                onValueChange={(nextValue) => {
                  handleUserDraftChange();
                  field.handleChange(nextValue);
                }}
                otherFields={otherFields}
                placeholder={placeholder}
                suggestionScope={suggestionScope}
                value={field.state.value}
              />
            )}
          </form.Subscribe>
        </ComposerFieldRow>
      );
    }}
  </form.Field>
);
