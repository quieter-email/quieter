"use client";

import type { MailboxLabelColor } from "@quieter/mail/mailbox-organization";
import { Input } from "@quieter/ui/input";
import { useIsPresent } from "motion/react";
import { useCallback, useRef, useState } from "react";

import { MailboxColorPicker } from "./mailbox-color-picker";

export const LabelsInlineEditor = ({
  kind,
  mode,
  initialName,
  initialColor,
  onCancel,
  onSubmit,
}: {
  kind: "label" | "group";
  mode: "create" | "rename";
  initialName: string;
  initialColor: MailboxLabelColor;
  onCancel: () => void;
  onSubmit: (draft: {
    name: string;
    color: MailboxLabelColor;
  }) => void | Promise<void>;
}) => {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);
  const [isSaving, setIsSaving] = useState(false);
  const saving = useRef(false);
  const colorOpen = useRef(false);
  const isPresent = useIsPresent();
  const creating = mode === "create";
  const nameLabel = kind === "group" ? "Group name" : "Label name";
  const focusName = useCallback(
    (input: HTMLInputElement | null) => {
      input?.focus({ preventScroll: true });
      if (mode === "rename") {
        input?.select();
      }
    },
    [mode]
  );

  const finish = async () => {
    if (saving.current || !isPresent) {
      return;
    }
    const trimmedName = name.trim();
    if (trimmedName === "" || (!creating && trimmedName === initialName)) {
      onCancel();
      return;
    }
    saving.current = true;
    setIsSaving(true);
    try {
      await onSubmit({ color, name: trimmedName });
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  };

  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Save when focus leaves both controls in the editor.
    <form
      aria-label={creating ? `New ${kind}` : `Rename ${kind}`}
      aria-busy={isSaving}
      className="flex min-w-0 flex-1 items-center gap-2"
      inert={!isPresent}
      onBlur={(event) => {
        if (
          !colorOpen.current &&
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          void finish();
        }
      }}
      onSubmit={(event) => {
        event.preventDefault();
        void finish();
      }}
    >
      {creating ? (
        <MailboxColorPicker
          className="flex shrink-0"
          disabled={isSaving}
          label={`New ${kind} color`}
          onChange={setColor}
          onOpenChange={(open, outsidePress) => {
            colorOpen.current = open;
            if (outsidePress && !open) {
              void finish();
            }
          }}
          swatchShape={kind === "group" ? "circle" : "square"}
          trigger="swatch"
          value={color}
        />
      ) : null}
      <Input
        aria-label={nameLabel}
        chrome="ghost"
        className="w-44 max-w-full"
        maxLength={kind === "group" ? 100 : 225}
        onChange={(event) => {
          setName(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (
            !event.nativeEvent.isComposing &&
            event.key === "Escape" &&
            !saving.current
          ) {
            event.preventDefault();
            event.stopPropagation();
            onCancel();
          }
        }}
        placeholder={nameLabel}
        readOnly={isSaving}
        ref={focusName}
        size="sm"
        value={name}
      />
    </form>
  );
};
