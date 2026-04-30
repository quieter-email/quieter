"use client";

import { AlertCircleIcon, Loading03Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Dialog, DialogContent, cn } from "@quieter/ui";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { forwardRef, type ReactNode, useImperativeHandle } from "react";
import type { ComposeFormValues } from "../domain/compose-form";
import { hasComposeDraftContent, type ComposeDraftState } from "../domain/draft";
import { ComposeEditor } from "./compose-editor";
import {
  getDraftStatusMessage,
  useComposeDialogController,
  type ComposeDialogController,
} from "./use-compose-dialog-controller";

export type ComposeDialogHandle = {
  openDraft: (draft: ComposeDraftState | null) => void;
  openNewMail: () => void;
};

type ComposeDialogProps = {
  mailboxId: string | null;
};

type ComposeTextFieldProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  endAdornment?: ReactNode;
  invalid?: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  spellCheck?: boolean;
  value: string;
};

type ComposeFormTextFieldProps = Omit<
  ComposeTextFieldProps,
  "invalid" | "onBlur" | "onChange" | "value"
> &
  Pick<ComposeDialogController, "clearActiveDraftError" | "form" | "scheduleAutosave"> & {
    name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc" | "subject">;
  };

const composeInputFrameClass =
  "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20";

const ComposeTextField = ({
  ariaLabel,
  className,
  disabled,
  endAdornment,
  invalid,
  onBlur,
  onChange,
  placeholder,
  spellCheck,
  value,
}: ComposeTextFieldProps) => (
  <div className="space-y-2">
    <div
      className={cn(composeInputFrameClass, className, {
        "bg-destructive/10": invalid,
      })}
    >
      <input
        aria-invalid={invalid}
        aria-label={ariaLabel}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
        disabled={disabled}
        onBlur={onBlur}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        spellCheck={spellCheck}
        type="text"
        value={value}
      />
      {endAdornment}
    </div>
  </div>
);

const ComposeFormTextField = ({
  clearActiveDraftError,
  form,
  name,
  scheduleAutosave,
  ...textFieldProps
}: ComposeFormTextFieldProps) => (
  <form.Field name={name}>
    {(field) => (
      <div className="space-y-2">
        <ComposeTextField
          {...textFieldProps}
          invalid={field.state.meta.errors.length > 0}
          onBlur={() => field.handleBlur()}
          onChange={(value) => {
            clearActiveDraftError();
            field.handleChange(value);
            scheduleAutosave();
          }}
          value={field.state.value}
        />
        {field.state.meta.errors.map((error) => (
          <p
            className="pl-1 text-xs text-destructive"
            key={error?.message ?? "An unknown error occurred."}
          >
            {error?.message ?? "An unknown error occurred."}
          </p>
        ))}
      </div>
    )}
  </form.Field>
);

const AnimatedRecipientField = ({
  children,
  id,
  open,
}: {
  children: ReactNode;
  id: string;
  open: boolean;
}) => {
  const prefersReducedMotion = useReducedMotion();
  const hiddenOffset = prefersReducedMotion ? 0 : -4;
  const transition = prefersReducedMotion
    ? { duration: 0 }
    : { duration: 0.09, ease: "easeOut" as const };

  return (
    <AnimatePresence initial={false}>
      {open && (
        <m.div
          animate={{ height: "auto", marginTop: 12, opacity: 1, y: 0 }}
          className="overflow-hidden"
          exit={{ height: 0, marginTop: 0, opacity: 0, y: hiddenOffset }}
          id={id}
          initial={{ height: 0, marginTop: 0, opacity: 0, y: hiddenOffset }}
          transition={transition}
        >
          {children}
        </m.div>
      )}
    </AnimatePresence>
  );
};

export const ComposeDialog = forwardRef<ComposeDialogHandle, ComposeDialogProps>(
  function ComposeDialog({ mailboxId }, ref) {
    const compose = useComposeDialogController({ mailboxId });
    const {
      state,
      addInlineImageFiles,
      clearActiveDraftError,
      discardActiveDraft,
      form,
      handleDialogOpenChange,
      scheduleAutosave,
      toggleRecipientVisibility,
    } = compose;

    useImperativeHandle(ref, () => ({
      openDraft: (draft) => {
        compose.openComposeDraft(draft);
      },
      openNewMail: () => {
        compose.openComposeDraft(null);
      },
    }));

    const canDiscardDraft = !!(state.draft.draftId || hasComposeDraftContent(state.draft));

    return (
      <Dialog onOpenChange={handleDialogOpenChange} open={state.open}>
        <DialogContent className="max-h-[85vh] w-[min(92vw,46rem)] overflow-hidden bg-background-light p-0 transition-opacity duration-100 data-ending-style:scale-100 data-starting-style:scale-100">
          <form
            action={async () => {
              await form.handleSubmit();
            }}
            className="flex max-h-[85vh] min-h-0 flex-col px-5 py-5 sm:px-6 sm:py-6"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              <div className="flex shrink-0 items-start justify-between gap-4 pb-1">
                <div className="space-y-1">
                  <p className="text-sm font-semibold tracking-tight text-foreground">
                    New message
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {getDraftStatusMessage(compose.state.draft)}
                  </p>
                </div>
              </div>

              <div className="shrink-0 space-y-3">
                <ComposeFormTextField
                  ariaLabel="Recipients"
                  clearActiveDraftError={clearActiveDraftError}
                  endAdornment={
                    <div className="flex shrink-0 items-center gap-3">
                      <button
                        aria-controls="compose-cc-field"
                        aria-expanded={state.showCc}
                        className={cn("text-xs transition-colors", {
                          "text-foreground": state.showCc,
                          "text-muted-foreground hover:text-foreground": !state.showCc,
                        })}
                        onClick={() => toggleRecipientVisibility("cc")}
                        type="button"
                      >
                        Cc
                      </button>
                      <button
                        aria-controls="compose-bcc-field"
                        aria-expanded={state.showBcc}
                        className={cn("text-xs transition-colors", {
                          "text-foreground": state.showBcc,
                          "text-muted-foreground hover:text-foreground": !state.showBcc,
                        })}
                        onClick={() => toggleRecipientVisibility("bcc")}
                        type="button"
                      >
                        Bcc
                      </button>
                    </div>
                  }
                  form={form}
                  name="to"
                  placeholder="To"
                  scheduleAutosave={scheduleAutosave}
                  spellCheck={false}
                />

                <LazyMotion features={domAnimation}>
                  <AnimatedRecipientField id="compose-cc-field" open={state.showCc}>
                    <ComposeFormTextField
                      ariaLabel="Cc recipients"
                      clearActiveDraftError={clearActiveDraftError}
                      form={form}
                      name="cc"
                      placeholder="Cc"
                      scheduleAutosave={scheduleAutosave}
                      spellCheck={false}
                    />
                  </AnimatedRecipientField>

                  <AnimatedRecipientField id="compose-bcc-field" open={state.showBcc}>
                    <ComposeFormTextField
                      ariaLabel="Bcc recipients"
                      clearActiveDraftError={clearActiveDraftError}
                      form={form}
                      name="bcc"
                      placeholder="Bcc"
                      scheduleAutosave={scheduleAutosave}
                      spellCheck={false}
                    />
                  </AnimatedRecipientField>
                </LazyMotion>

                <ComposeFormTextField
                  ariaLabel="Subject"
                  className="mt-3"
                  clearActiveDraftError={clearActiveDraftError}
                  form={form}
                  name="subject"
                  placeholder="Subject"
                  scheduleAutosave={scheduleAutosave}
                />
              </div>

              <form.Field name="bodyHtml">
                {(field) => (
                  <ComposeEditor
                    className="flex-1"
                    disabled={state.draft.saveStatus === "sending" || !mailboxId}
                    html={field.state.value}
                    onBlur={() => field.handleBlur()}
                    onChange={({ html, text }) => {
                      clearActiveDraftError();
                      field.handleChange(html);
                      form.setFieldValue("bodyText", text);
                      scheduleAutosave();
                    }}
                    onInlineImageFiles={addInlineImageFiles}
                  />
                )}
              </form.Field>

              <div className="flex min-h-10 shrink-0 items-center justify-end gap-3 pt-1">
                {state.draft.errorMessage && (
                  <div
                    aria-live="polite"
                    className="mr-auto flex min-w-0 items-center gap-2 text-sm text-destructive"
                  >
                    <HugeiconsIcon className="size-4 shrink-0" icon={AlertCircleIcon} />
                    <span className="truncate">{state.draft.errorMessage}</span>
                  </div>
                )}

                {canDiscardDraft && (
                  <Button
                    className={cn({ "mr-auto": !state.draft.errorMessage })}
                    disabled={state.draft.saveStatus === "sending"}
                    onClick={() => {
                      void discardActiveDraft();
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {state.draft.draftId ? "Discard draft" : "Discard"}
                  </Button>
                )}

                <Button
                  disabled={state.draft.saveStatus === "sending" || !mailboxId}
                  size="sm"
                  type="submit"
                  variant={state.draft.saveStatus === "sending" ? "outline" : "default"}
                >
                  {state.draft.saveStatus === "sending" ? (
                    <HugeiconsIcon className="animate-spin" icon={Loading03Icon} />
                  ) : (
                    <HugeiconsIcon icon={MailSend02Icon} />
                  )}
                  Send
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    );
  },
);
