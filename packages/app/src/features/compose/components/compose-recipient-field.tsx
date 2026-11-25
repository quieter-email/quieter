"use client";

import type { ComposeDialogController } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import { AutocompleteField } from "@quieter/ui/autocomplete";
import { ComposerFieldRow } from "@quieter/ui/composer-chrome";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";

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
  const [active, setActive] = useState<{
    completion: RecipientCompletion;
    scopeId: string;
    value: string;
  } | null>(null);
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
        otherFields,
        suggestions: loaded,
        value,
      })
    : [];
  const dismiss = () => {
    setActive(null);
  };

  return (
    <AutocompleteField
      {...props}
      chrome="composer"
      onBlur={(event) => {
        dismiss();
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
      onSuggestionSelect={(email) => {
        if (!completion) {
          return value.length;
        }
        const next = applyRecipientCompletion(value, completion, email);
        dismiss();
        onValueChange(next.value);
        return next.caret;
      }}
      onValueChange={(nextValue, { caret, typed }) => {
        const nextCompletion =
          typed && caret !== null && suggestionScope
            ? getRecipientCompletion(nextValue, caret)
            : null;
        setActive(
          nextCompletion && suggestionScope
            ? {
                completion: nextCompletion,
                scopeId: suggestionScope.id,
                value: nextValue,
              }
            : null
        );
        onValueChange(nextValue);
      }}
      open={completion !== null}
      spellCheck={false}
      suggestions={suggestions.map(({ email, name }) =>
        name?.trim()
          ? { description: email, label: name, value: email }
          : { label: email, value: email }
      )}
      value={value}
    />
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
