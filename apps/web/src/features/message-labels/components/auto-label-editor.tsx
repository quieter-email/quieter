"use client";

import { autoLabelSettingsSchema } from "@quieter/mail/auto-label";
import type { MailboxLabel } from "@quieter/mail/mailbox-organization";
import { Button } from "@quieter/ui/button";
import { ColorSwatch } from "@quieter/ui/color-swatch";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import { Textarea } from "@quieter/ui/textarea";
import { useId, useState } from "react";

import { getAutoLabelPrompt } from "#/features/message-labels/domain/auto-label-prompt";

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
  onSave: (prompt: string) => Promise<boolean>;
}) => {
  const id = useId();
  const [prompt, setPrompt] = useState(() => getAutoLabelPrompt(label));
  const [showErrors, setShowErrors] = useState(false);
  const parsed = autoLabelSettingsSchema.shape.prompt.safeParse(prompt);
  const disabled = !canManage || isPending;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !isPending) {
          onCancel();
        }
      }}
    >
      <DialogContent className="flex max-h-[90dvh] flex-col">
        <form
          aria-label={`Auto-label ${label.name}`}
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            setShowErrors(true);
            if (parsed.success) {
              void onSave(parsed.data);
            }
          }}
        >
          <DialogHeader className="shrink-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <ColorSwatch
                color={
                  label.color?.startsWith("#") === true
                    ? label.color
                    : `var(--q-${label.color ?? "gray"})`
                }
              />
              <div className="min-w-0 flex-1">
                <DialogTitle>
                  <span className="block truncate">
                    Auto-label {label.name}
                  </span>
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>
          <DialogBody className="min-h-0 overflow-y-auto" spacing="3">
            <label className="sr-only" htmlFor={`${id}-prompt`}>
              AI prompt
            </label>
            <Textarea
              aria-describedby={
                showErrors && !parsed.success ? `${id}-error` : undefined
              }
              aria-invalid={showErrors && !parsed.success}
              disabled={disabled}
              id={`${id}-prompt`}
              maxLength={4000}
              onChange={(event) => {
                setPrompt(event.target.value);
              }}
              placeholder="Describe which emails belong here…"
              rows={5}
              value={prompt}
            />
            {showErrors && !parsed.success ? (
              <p
                className="text-caption text-destructive"
                id={`${id}-error`}
                role="alert"
              >
                {parsed.error.issues[0]?.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter className="shrink-0">
            <Button
              disabled={isPending}
              onClick={onCancel}
              size="sm"
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={disabled}
              pending={isPending}
              pendingLabel="Saving…"
              size="sm"
              type="submit"
            >
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
