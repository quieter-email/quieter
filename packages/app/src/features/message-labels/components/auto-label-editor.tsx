"use client";

import { getAutoLabelPrompt } from "@quieter/app/features/message-labels/domain/auto-label-prompt";
import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { AutoLabelSettings } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Textarea } from "@quieter/ui/textarea";
import { useCallback, useRef, useState } from "react";

export const AutoLabelEditor = ({
  label,
  onCancel,
  onSave,
}: {
  label: MailboxLabel;
  onCancel: () => void;
  onSave: (settings: AutoLabelSettings) => Promise<boolean>;
}) => {
  const initialPrompt = getAutoLabelPrompt(label);
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isSaving, setIsSaving] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const saving = useRef(false);
  const closed = useRef(false);
  const focusPrompt = useCallback((input: HTMLTextAreaElement | null) => {
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  const finish = async () => {
    if (saving.current || closed.current) {
      return;
    }
    const trimmed = prompt.trim();
    if (trimmed === initialPrompt.trim()) {
      closed.current = true;
      onCancel();
      return;
    }
    const parsed = autoLabelSettingsSchema.shape.prompt.safeParse(trimmed);
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    saving.current = true;
    setIsSaving(true);
    try {
      closed.current = await onSave({
        domains: [],
        enabled: label.autoLabel?.enabled !== false,
        keywordScope: "anywhere",
        keywords: [],
        matchMode: "all",
        prompt: parsed.data,
        recipients: [],
        senders: [],
      });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    <Textarea
      aria-busy={isSaving}
      aria-invalid={invalid}
      aria-label={`Auto-label prompt for ${label.name}`}
      maxLength={4000}
      onBlur={() => {
        void finish();
      }}
      onChange={(event) => {
        setInvalid(false);
        setPrompt(event.currentTarget.value);
      }}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || saving.current) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closed.current = true;
          onCancel();
        } else if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          void finish();
        }
      }}
      placeholder="Describe which emails belong here…"
      readOnly={isSaving}
      ref={focusPrompt}
      rows={1}
      value={prompt}
      variant="inline"
    />
  );
};
