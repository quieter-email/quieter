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
} from "@quieter/mail/compose/schema";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { Dialog, DialogContent } from "@quieter/ui/dialog";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { type UseAudioRecorderReturn, useAudioRecorder } from "@tanstack/ai-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import {
  type ClipboardEvent,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { USER_BILLING_QUERY_KEY } from "~/features/settings/domain/billing";
import { type BrowserAudioRecording, getTranscriptionAudioFormat } from "~/lib/audio-transcription";
import { parseSender } from "~/lib/gmail/message-utils";
import { orpc } from "~/lib/orpc";
import type { ComposeFormValues } from "../domain/compose-form";
import type { TemplatePlaceholderRange } from "../domain/template-placeholders";
import {
  hasComposeDraftContent,
  normalizeComposeBodyHtml,
  textToComposeBodyHtml,
  type ComposeDraftState,
} from "../domain/draft";
import {
  ComposeEditor,
  ComposeEditorBody,
  ComposeEditorDictationButton,
  type ComposeEditorHandle,
  ComposeEditorToolbar,
} from "./compose-editor";
import { ComposeTemplatePicker, TemplatePlaceholderSuggestion } from "./compose-templates";
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
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onManageTemplates?: () => void;
  persistDrafts?: boolean;
  senderEmail?: string | null;
  ref?: Ref<ComposeDialogHandle>;
};

type ComposeTextFieldProps = {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  endAdornment?: ReactNode;
  invalid?: boolean;
  label: string;
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
  className?: string;
  disabled?: boolean;
  endAdornment?: ReactNode;
  invalid?: boolean;
  label: string;
  onBlur: () => void;
  onChange: (value: string) => void;
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
  "compose-input-frame flex min-h-11 items-center gap-3 rounded-lg border border-transparent bg-transparent px-4 outline-none transition-[border-color,box-shadow,background-color]";
const composeInputLabelClass =
  "flex w-10 shrink-0 items-center text-xs font-normal text-muted-foreground";

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
  label,
  onBlur,
  onChange,
  placeholder,
  spellCheck,
  value,
}: ComposeTextFieldProps) => (
  <div>
    <div
      className={cn(composeInputFrameClass, className, {
        "bg-destructive/10": invalid,
      })}
    >
      <span className={composeInputLabelClass}>{label}</span>
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
  className,
  disabled,
  endAdornment,
  invalid,
  label,
  onBlur,
  onChange,
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
    <div>
      <div
        className={cn(
          composeInputFrameClass,
          "min-h-11 flex-wrap items-start gap-2 py-1.5 pr-2",
          className,
          {
            "bg-destructive/10": invalid,
            "cursor-text": !disabled,
          },
        )}
      >
        <span className={cn(composeInputLabelClass, "h-8")}>{label}</span>
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
            spellCheck={false}
            type="text"
            value={inputValue}
          />
        </div>
        {endAdornment && <div className="shrink-0">{endAdornment}</div>}
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

const AdditionalRecipientField = ({
  children,
  id,
  open,
}: {
  children: ReactNode;
  id: string;
  open: boolean;
}) => {
  const reducedMotion = useReducedMotion();

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <m.div
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          id={id}
          initial={{ height: 0, opacity: 0 }}
          transition={
            reducedMotion ? { duration: 0 } : { duration: 0.18, ease: [0.32, 0.72, 0, 1] }
          }
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
};

export const ComposeDialog = ({
  demoMode = false,
  managedDemoMode = false,
  mailboxId,
  onManageTemplates,
  persistDrafts = true,
  senderEmail,
  ref,
}: ComposeDialogProps) => {
  const queryClient = useQueryClient();
  const composeEditorRef = useRef<ComposeEditorHandle | null>(null);
  const [selectedPlaceholder, setSelectedPlaceholder] = useState<TemplatePlaceholderRange | null>(
    null,
  );
  const [activeTemplateName, setActiveTemplateName] = useState("Email template");
  const compose = useComposeDialogController({
    demoMode,
    managedDemoMode,
    mailboxId,
    persistDrafts,
  });
  const {
    state,
    addInlineImageFiles,
    clearActiveDraftError,
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    toggleRecipientVisibility,
  } = compose;
  const audioRecorder = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
  }) as UseAudioRecorderReturn<BrowserAudioRecording>;
  const transcribeAudioMutation = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const isTranscribingAudio = transcribeAudioMutation.isPending;

  useImperativeHandle(ref, () => ({
    openDraft: (draft) => {
      setSelectedPlaceholder(null);
      setActiveTemplateName("Email template");
      compose.openComposeDraft(draft);
    },
    openNewMail: () => {
      setSelectedPlaceholder(null);
      setActiveTemplateName("Email template");
      compose.openComposeDraft(null);
    },
  }));

  const canDiscardDraft = !!(state.draft.draftId || hasComposeDraftContent(state.draft));
  const canEditBody = state.draft.saveStatus !== "sending" && !!mailboxId;
  const audioBusy = audioRecorder.isRecording || isTranscribingAudio;
  const canSubmitCompose = canEditBody && !audioBusy;

  const handleRecordingStart = () => {
    if (!canEditBody || isTranscribingAudio) return;

    if (!audioRecorder.isSupported) {
      compose.setActiveDraftError("Audio recording is not supported in this browser.");
      return;
    }

    void audioRecorder.start().catch(() => {
      compose.setActiveDraftError("Could not start recording.");
    });
  };

  const handleRecordingStop = () => {
    void (async () => {
      try {
        const recording = await audioRecorder.stop();
        const format = getTranscriptionAudioFormat(recording.mimeType);

        if (!format) {
          compose.setActiveDraftError("This audio format is not supported.");
          return;
        }

        const result = await transcribeAudioMutation.mutateAsync({
          audioBase64: recording.base64,
          durationMs: recording.durationMs,
          format,
          mailboxId: mailboxId!,
          mode: "email",
        });
        const currentHtml = normalizeComposeBodyHtml(form.state.values.bodyHtml);
        const currentText = form.state.values.bodyText.trim();
        const nextText = currentText ? `${currentText}\n\n${result.text}` : result.text;
        const nextHtml = `${currentHtml}${textToComposeBodyHtml(result.text)}`;

        clearActiveDraftError();
        form.setFieldValue("bodyHtml", nextHtml);
        form.setFieldValue("bodyText", nextText);
      } catch (error) {
        compose.setActiveDraftError(
          error instanceof Error && error.message
            ? error.message
            : "Could not transcribe recording.",
        );
      }
    })();
  };

  useHotkey(
    "Mod+Enter",
    (event) => {
      const target = event.target;
      if (target instanceof Element && !target.closest("[data-compose-dialog-content]")) {
        return;
      }

      void form.handleSubmit();
    },
    {
      enabled: state.open && canSubmitCompose,
      ignoreInputs: false,
    },
  );

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={state.open}>
      <LazyMotion features={domAnimation}>
        <DialogContent
          className="squircle h-[min(92vh,58rem)] max-h-[94vh] w-[min(96vw,72rem)] overflow-hidden rounded-4xl border-border bg-background p-0 transition-opacity duration-100 data-ending-style:scale-100 data-starting-style:scale-100"
          data-compose-dialog-content
        >
          <form
            action={async () => {
              await form.handleSubmit();
            }}
            className="flex h-full min-h-0 flex-col p-3 sm:p-5"
          >
            <div className="squircle flex min-h-0 flex-1 flex-col gap-2 rounded-2xl border bg-background-dark/60 p-2">
              <div className="flex shrink-0 items-center px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-foreground">New message</p>
                  <p className="sr-only">
                    {getDraftStatusMessage(compose.state.draft, persistDrafts)}
                  </p>
                </div>
              </div>

              <div className="squircle shrink-0 rounded-xl border border-border bg-background-dark">
                {senderEmail && (
                  <>
                    <div className={composeInputFrameClass}>
                      <span className={composeInputLabelClass}>From</span>
                      <span className="min-w-0 truncate text-sm text-foreground">
                        {senderEmail}
                      </span>
                    </div>
                    <div className="h-[0.5px] w-full bg-border" />
                  </>
                )}
                <ComposeFormRecipientField
                  ariaLabel="Recipients"
                  clearActiveDraftError={clearActiveDraftError}
                  endAdornment={
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        aria-controls="compose-cc-field"
                        className="text-xs"
                        aria-expanded={state.showCc}
                        onClick={() => toggleRecipientVisibility("cc")}
                        size="sm"
                        variant={state.showCc ? "outline" : "ghost"}
                      >
                        CC
                      </Button>
                      <Button
                        aria-controls="compose-bcc-field"
                        className="text-xs"
                        aria-expanded={state.showBcc}
                        onClick={() => toggleRecipientVisibility("bcc")}
                        size="sm"
                        variant={state.showBcc ? "outline" : "ghost"}
                      >
                        BCC
                      </Button>
                    </div>
                  }
                  form={form}
                  label="To"
                  name="to"
                />

                <div className="h-[0.5px] w-full bg-border" />

                <>
                  <AdditionalRecipientField id="compose-cc-field" open={state.showCc}>
                    <ComposeFormRecipientField
                      ariaLabel="Cc recipients"
                      clearActiveDraftError={clearActiveDraftError}
                      form={form}
                      label="Cc"
                      name="cc"
                    />
                  </AdditionalRecipientField>
                  {state.showCc && <div className="h-[0.5px] w-full bg-border" />}
                  <AdditionalRecipientField id="compose-bcc-field" open={state.showBcc}>
                    <ComposeFormRecipientField
                      ariaLabel="Bcc recipients"
                      clearActiveDraftError={clearActiveDraftError}
                      form={form}
                      label="Bcc"
                      name="bcc"
                    />
                  </AdditionalRecipientField>
                  {state.showBcc && <div className="h-[0.5px] w-full bg-border" />}
                </>

                <ComposeFormTextField
                  ariaLabel="Subject"
                  clearActiveDraftError={clearActiveDraftError}
                  form={form}
                  label="Subject"
                  name="subject"
                  placeholder=""
                />
              </div>

              <form.Field name="bodyHtml">
                {(field) => (
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    <ComposeEditor
                      disabled={!canEditBody}
                      html={field.state.value}
                      onBlur={() => field.handleBlur()}
                      onChange={({ html, text }) => {
                        if (
                          normalizeComposeBodyHtml(html) !==
                            normalizeComposeBodyHtml(field.state.value) ||
                          text !== form.state.values.bodyText
                        ) {
                          clearActiveDraftError();
                        }
                        field.handleChange(html);
                        form.setFieldValue("bodyText", text);
                      }}
                      onInlineImageFiles={addInlineImageFiles}
                      onPlaceholderSelectionChange={setSelectedPlaceholder}
                      onRecordingStart={handleRecordingStart}
                      onRecordingStop={handleRecordingStop}
                      recording={audioRecorder.isRecording}
                      recordingSupported={audioRecorder.isSupported}
                      ref={composeEditorRef}
                      transcribing={isTranscribingAudio}
                    >
                      <div className="flex min-h-0 flex-1 flex-col">
                        <ComposeEditorBody className="squircle min-h-0 flex-1 rounded-xl border border-border bg-background-dark p-5 sm:p-7" />
                        <div className="flex shrink-0 items-center gap-1 px-2 pt-3 pb-2">
                          <ComposeEditorToolbar />
                          {mailboxId ? (
                            <>
                              <ComposeTemplatePicker
                                disabled={!canEditBody || audioBusy}
                                mailboxId={mailboxId}
                                onManage={() => {
                                  handleDialogOpenChange(false);
                                  onManageTemplates?.();
                                }}
                                onInsert={(template) => {
                                  clearActiveDraftError();
                                  setActiveTemplateName(template.name);
                                  composeEditorRef.current?.insertHtml(template.bodyHtml);
                                }}
                              />
                              <TemplatePlaceholderSuggestion
                                bodyText={form.state.values.bodyText}
                                disabled={!canEditBody || audioBusy}
                                editorRef={composeEditorRef}
                                mailboxId={mailboxId}
                                placeholder={selectedPlaceholder}
                                recipients={[
                                  form.state.values.to,
                                  form.state.values.cc,
                                  form.state.values.bcc,
                                ]
                                  .filter(Boolean)
                                  .join(", ")}
                                subject={form.state.values.subject}
                                templateName={activeTemplateName}
                              />
                            </>
                          ) : null}
                          <div className="ml-auto flex shrink-0 items-center gap-1">
                            <ComposeEditorDictationButton />
                            {canDiscardDraft ? (
                              <Button
                                disabled={state.draft.saveStatus === "sending"}
                                onClick={() => {
                                  discardActiveDraft();
                                }}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                {state.draft.draftId ? "Discard draft" : "Discard"}
                              </Button>
                            ) : null}
                            <Button
                              disabled={!canSubmitCompose}
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
                      </div>
                    </ComposeEditor>
                    {field.state.meta.errors.map((error) => (
                      <p
                        className="px-1 text-xs text-destructive"
                        key={error?.message ?? "An unknown error occurred."}
                      >
                        {error?.message ?? "An unknown error occurred."}
                      </p>
                    ))}
                  </div>
                )}
              </form.Field>

              {state.draft.errorMessage ? (
                <div
                  aria-live="polite"
                  className="flex min-w-0 shrink-0 items-start gap-2 pb-2 pl-4 text-sm text-destructive"
                  role="alert"
                >
                  <HugeiconsIcon className="mt-0.5 size-4 shrink-0" icon={AlertCircleIcon} />
                  <span className="min-w-0 wrap-break-word">{state.draft.errorMessage}</span>
                </div>
              ) : null}
            </div>
          </form>
        </DialogContent>
      </LazyMotion>
    </Dialog>
  );
};
