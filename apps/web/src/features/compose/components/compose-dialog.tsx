"use client";

import {
  AlertCircleIcon,
  Cancel01Icon,
  Loading03Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  findInvalidMailAddresses,
  getMailAddressKey,
  splitMailAddressList,
} from "@quieter/mail/compose";
import { Button, Dialog, DialogContent, IconButtonTooltip, cn } from "@quieter/ui";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useState,
} from "react";
import { parseSender } from "~/lib/gmail/message-utils";
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
  demoMode?: boolean;
  mailboxId: string | null;
  ref?: Ref<ComposeDialogHandle>;
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
  Pick<ComposeDialogController, "clearActiveDraftError" | "form"> & {
    name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc" | "subject">;
  };

type ComposeRecipientFieldProps = {
  ariaLabel: string;
  disabled?: boolean;
  endAdornment?: ReactNode;
  invalid?: boolean;
  onBlur: () => void;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

type ComposeFormRecipientFieldProps = Omit<
  ComposeRecipientFieldProps,
  "invalid" | "onBlur" | "onChange" | "value"
> &
  Pick<ComposeDialogController, "clearActiveDraftError" | "form"> & {
    name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc">;
  };

type RecipientInputState = {
  inputValue: string;
  pendingValue: string | null;
  serializedValue: string;
  tokens: string[];
};

const composeInputFrameClass =
  "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20";

const serializeRecipientValue = (tokens: readonly string[], inputValue: string) =>
  [...tokens, inputValue.trim()].filter(Boolean).join(", ");

const parseRecipientInputState = (value: string): RecipientInputState => ({
  inputValue: "",
  pendingValue: null,
  serializedValue: value,
  tokens: mergeRecipientTokens([], splitMailAddressList(value)),
});

const mergeRecipientTokens = (currentTokens: readonly string[], nextTokens: readonly string[]) => {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const token of [...currentTokens, ...nextTokens]) {
    const normalized = token.trim();
    if (!normalized) continue;
    const key = getMailAddressKey(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
};

const getRecipientDisplay = (value: string) => {
  const sender = parseSender(value);
  const fallback = value.trim();
  const label = sender.name || sender.email || sender.display || fallback;
  const detail = sender.name && sender.email ? sender.email : "";

  return { detail, label };
};

const hasRecipientDelimiter = (value: string) => /[,;\n]/.test(value);

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
        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm/6 text-foreground outline-none placeholder:text-muted-foreground/60"
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

const RecipientChip = ({
  disabled,
  invalid,
  onRemove,
  value,
}: {
  disabled?: boolean;
  invalid: boolean;
  onRemove: () => void;
  value: string;
}) => {
  const { detail, label } = getRecipientDisplay(value);
  const removeLabel = `Remove ${label}`;

  return (
    <span
      className={cn(
        "group inline-flex min-h-8 max-w-full items-center gap-2 rounded-md border bg-muted/50 px-2.5 py-1 text-left text-xs transition-colors",
        {
          "border-destructive/40 bg-destructive/10 text-destructive": invalid,
          "border-border text-foreground": !invalid,
        },
      )}
    >
      <span className="min-w-0">
        <span className="block truncate leading-4 font-medium">{label}</span>
        {detail && (
          <span
            className={cn("block truncate text-[11px]/3", {
              "text-destructive/75": invalid,
              "text-muted-foreground": !invalid,
            })}
          >
            {detail}
          </span>
        )}
      </span>
      {!disabled && (
        <IconButtonTooltip label={removeLabel}>
          <button
            aria-label={removeLabel}
            className={cn(
              "grid size-4 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
              {
                "text-destructive/70 hover:text-destructive": invalid,
              },
            )}
            onClick={onRemove}
            type="button"
          >
            <HugeiconsIcon className="size-3" icon={Cancel01Icon} />
          </button>
        </IconButtonTooltip>
      )}
    </span>
  );
};

const ComposeRecipientField = ({
  ariaLabel,
  disabled,
  endAdornment,
  invalid,
  onBlur,
  onChange,
  placeholder,
  value,
}: ComposeRecipientFieldProps) => {
  const [recipientState, setRecipientState] = useState<RecipientInputState>({
    inputValue: "",
    pendingValue: null,
    serializedValue: "",
    tokens: [],
  });

  if (recipientState.pendingValue) {
    if (value === recipientState.pendingValue) {
      setRecipientState({ ...recipientState, pendingValue: null });
    }
  } else if (value !== recipientState.serializedValue) {
    setRecipientState(parseRecipientInputState(value));
  }

  const { inputValue, tokens } = recipientState;

  const emitValue = (nextTokens: string[], nextInputValue: string) => {
    const nextValue = serializeRecipientValue(nextTokens, nextInputValue);
    setRecipientState({
      inputValue: nextInputValue,
      pendingValue: nextValue,
      serializedValue: nextValue,
      tokens: nextTokens,
    });
    onChange(nextValue);
  };

  const commitInputValue = (rawValue = inputValue) => {
    const entries = splitMailAddressList(rawValue);
    emitValue(entries.length > 0 ? mergeRecipientTokens(tokens, entries) : tokens, "");
  };

  const updateInputValue = (nextInputValue: string) => {
    if (hasRecipientDelimiter(nextInputValue)) {
      commitInputValue(nextInputValue);
      return;
    }

    emitValue(tokens, nextInputValue);
  };

  const removeToken = (index: number) => {
    emitValue(
      tokens.filter((_, tokenIndex) => tokenIndex !== index),
      inputValue,
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === "Tab" || event.key === "," || event.key === ";") {
      if (inputValue.trim()) {
        event.preventDefault();
        commitInputValue();
      }
      return;
    }

    if (event.key !== "Backspace" || inputValue || tokens.length === 0) return;

    event.preventDefault();
    const nextTokens = tokens.slice(0, -1);
    const tokenToEdit = tokens.at(-1) ?? "";
    emitValue(nextTokens, tokenToEdit);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pastedValue = event.clipboardData.getData("text");
    if (!hasRecipientDelimiter(pastedValue)) return;

    event.preventDefault();
    const entries = splitMailAddressList(`${inputValue} ${pastedValue}`);
    emitValue(mergeRecipientTokens(tokens, entries), "");
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(composeInputFrameClass, "min-h-11 flex-wrap items-start gap-2 py-1.5 pr-2", {
          "bg-destructive/10": invalid,
          "cursor-text": !disabled,
        })}
      >
        <span className="mt-1.5 shrink-0 text-xs font-medium text-muted-foreground">
          {placeholder}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
          {tokens.map((token, index) => (
            <RecipientChip
              disabled={disabled}
              invalid={findInvalidMailAddresses(token).length > 0}
              key={getMailAddressKey(token)}
              onRemove={() => removeToken(index)}
              value={token}
            />
          ))}
          <input
            aria-invalid={invalid}
            aria-label={ariaLabel}
            autoComplete="off"
            className="h-8 min-w-[12ch] flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/60"
            disabled={disabled}
            onBlur={() => {
              commitInputValue();
              onBlur();
            }}
            onChange={(event) => updateInputValue(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={tokens.length > 0 ? "" : placeholder}
            spellCheck={false}
            type="text"
            value={inputValue}
          />
        </div>
        {endAdornment && <div className="mt-1.5 shrink-0">{endAdornment}</div>}
      </div>
    </div>
  );
};

const ComposeFormTextField = ({
  clearActiveDraftError,
  form,
  name,
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

const ComposeFormRecipientField = ({
  clearActiveDraftError,
  form,
  name,
  ...recipientFieldProps
}: ComposeFormRecipientFieldProps) => (
  <form.Field name={name}>
    {(field) => (
      <div className="space-y-2">
        <ComposeRecipientField
          {...recipientFieldProps}
          invalid={field.state.meta.errors.length > 0}
          onBlur={() => field.handleBlur()}
          onChange={(value) => {
            clearActiveDraftError();
            field.handleChange(value);
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

export const ComposeDialog = ({ demoMode = false, mailboxId, ref }: ComposeDialogProps) => {
  const compose = useComposeDialogController({ demoMode, mailboxId });
  const {
    state,
    addInlineImageFiles,
    clearActiveDraftError,
    discardActiveDraft,
    form,
    handleDialogOpenChange,
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
          className="flex max-h-[85vh] min-h-0 flex-col p-5 sm:p-6"
        >
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            <div className="flex shrink-0 items-start justify-between gap-4 pb-1">
              <div className="space-y-1">
                <p className="text-sm font-semibold tracking-tight text-foreground">New message</p>
                <p className="text-xs text-muted-foreground">
                  {getDraftStatusMessage(compose.state.draft)}
                </p>
              </div>
            </div>

            <div className="shrink-0 space-y-3">
              <ComposeFormRecipientField
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
              />

              <LazyMotion features={domAnimation}>
                <AnimatedRecipientField id="compose-cc-field" open={state.showCc}>
                  <ComposeFormRecipientField
                    ariaLabel="Cc recipients"
                    clearActiveDraftError={clearActiveDraftError}
                    form={form}
                    name="cc"
                    placeholder="Cc"
                  />
                </AnimatedRecipientField>

                <AnimatedRecipientField id="compose-bcc-field" open={state.showBcc}>
                  <ComposeFormRecipientField
                    ariaLabel="Bcc recipients"
                    clearActiveDraftError={clearActiveDraftError}
                    form={form}
                    name="bcc"
                    placeholder="Bcc"
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
};
