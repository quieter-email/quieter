"use client";

import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { Surface } from "@quieter/ui/surface";
import { Textarea } from "@quieter/ui/textarea";
import { useCallback, useId, useState } from "react";

export const AutoLabelEditor = ({
  canManage,
  isPending,
  label,
  onCancel,
  onSave,
}: {
  canManage: boolean;
  isPending: boolean;
  label: MailboxLabel;
  onCancel: () => void;
  onSave: (settings: AutoLabelSettings) => Promise<boolean>;
}) => {
  const id = useId();
  const initialPrompt =
    label.autoLabel?.prompt ?? label.inclusionCriteria ?? "";
  const [prompt, setPrompt] = useState(initialPrompt);
  const [showErrors, setShowErrors] = useState(false);
  const parsed = autoLabelSettingsSchema.shape.prompt.safeParse(prompt);
  const hasValidationError = showErrors && !parsed.success;
  const disabled = !canManage || isPending;
  const focusPrompt = useCallback((input: HTMLTextAreaElement | null) => {
    input?.focus();
  }, []);

  return (
    <form
      aria-label={`Auto-label ${label.name}`}
      className="grid min-w-0 gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled) {
          return;
        }
        setShowErrors(true);
        if (!parsed.success) {
          return;
        }
        void onSave({
          ...(label.autoLabel ?? {
            domains: [],
            enabled: true,
            keywordScope: "anywhere",
            keywords: [],
            matchMode: "all",
            recipients: [],
            senders: [],
          }),
          prompt: parsed.data,
        });
      }}
    >
      <div className="flex min-w-0 flex-wrap items-end gap-2">
        <Surface className="min-w-32 flex-1" padding="none" variant="detail">
          <Textarea
            aria-describedby={hasValidationError ? `${id}-error` : undefined}
            aria-invalid={hasValidationError}
            aria-label={`Auto-label prompt for ${label.name}`}
            disabled={disabled}
            maxLength={4000}
            onChange={(event) => {
              setPrompt(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (
                !isPending &&
                !event.nativeEvent.isComposing &&
                event.key === "Escape"
              ) {
                event.preventDefault();
                event.stopPropagation();
                onCancel();
              }
            }}
            placeholder="Describe which emails belong here…"
            ref={focusPrompt}
            rows={1}
            value={prompt}
            variant="compact-prompt"
          />
        </Surface>
        <div className="ms-auto flex items-center gap-1">
          <Button
            disabled={isPending}
            onClick={onCancel}
            size="compact"
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            disabled={disabled}
            pending={isPending}
            pendingLabel="Saving…"
            size="compact"
            type="submit"
          >
            Save
          </Button>
        </div>
      </div>
      {hasValidationError && !parsed.success ? (
        <p
          className="text-caption text-destructive"
          id={`${id}-error`}
          role="alert"
        >
          {parsed.error.issues[0]?.message}
        </p>
      ) : null}
    </form>
  );
};
