"use client";

import {
  AlertCircleIcon,
  Cancel01Icon,
  Delete02Icon,
  Loading03Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import { FieldControl, FieldError } from "@quieter/ui/field";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useRef, useState } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { WorkspaceSection } from "#/components/workspace-section";
import { USER_BILLING_QUERY_KEY } from "#/features/settings/domain/billing";
import { useAudioRecorder } from "#/lib/audio-recorder";
import { getTranscriptionAudioFormat } from "#/lib/audio-transcription";
import { orpc } from "#/lib/orpc";

import type { ComposeFormValues } from "../domain/compose-form";
import { takePendingComposeSession } from "../domain/compose-session";
import {
  normalizeComposeBodyHtml,
  textToComposeBodyHtml,
} from "../domain/draft";
import type { ComposeDraftState } from "../domain/draft";
import type { TemplatePlaceholderRange } from "../domain/template-placeholders";
import {
  ComposeEditor,
  ComposeEditorBody,
  ComposeEditorDictationButton,
  ComposeEditorToolbar,
} from "./compose-editor";
import type { ComposeEditorHandle } from "./compose-editor";
import {
  ComposeTemplatePicker,
  TemplatePlaceholderSuggestion,
} from "./compose-templates";
import {
  ComposerEditorFrame,
  ComposerFieldGroup,
  composerFieldControlClassName,
  ComposerFieldRow,
  ComposerFrame,
} from "./composer-chrome";
import {
  getDraftStatusMessage,
  useComposeDialogController,
} from "./use-compose-dialog-controller";
import type { ComposeDialogController } from "./use-compose-dialog-controller";

export type ComposeSurfaceProps = {
  className?: string;
  demoMode?: boolean;
  initialDraft?: ComposeDraftState | null;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onClose: () => void;
  onManageTemplates?: () => void;
  persistDrafts?: boolean;
  senderEmail?: string | null;
  signature?: { html: string | null; text: string | null };
  variant?: "inline" | "workspace";
};

type ComposeWorkspaceProps = Omit<
  ComposeSurfaceProps,
  "className" | "initialDraft" | "variant"
> & {
  onOpenSidebar: () => void;
};

type ComposeFormFieldProps = Pick<
  ComposeDialogController,
  "clearActiveDraftError" | "form"
> & {
  disabled?: boolean;
  divided?: boolean;
  label: string;
  name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc" | "subject">;
  placeholder?: string;
};

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

/**
 * The recipient input lives inside a shared field primitive that does not take
 * a ref, so it is found by its marker attribute.
 */
const focusComposeRecipientField = () => {
  document
    .querySelector<HTMLElement>("[data-compose-recipient-field]")
    ?.focus({ preventScroll: false });
};

const composeRecipientMotion = {
  animate: { filter: "blur(0px)", gridTemplateRows: "1fr", opacity: 1 },
  exit: { filter: "blur(2px)", gridTemplateRows: "0fr", opacity: 0 },
  initial: { filter: "blur(2px)", gridTemplateRows: "0fr", opacity: 0 },
  transition: { duration: 0.16, ease: "easeOut" },
} as const;

const ComposeFormField = ({
  clearActiveDraftError,
  disabled,
  divided,
  form,
  label,
  name,
  placeholder,
}: ComposeFormFieldProps) => (
  <form.Field name={name}>
    {(field) => {
      const [error] = field.state.meta.errors;
      return (
        <ComposerFieldRow
          divided={divided}
          error={error ? (error.message ?? "Invalid value") : undefined}
          label={label}
        >
          <FieldControl
            aria-invalid={!!error}
            className={composerFieldControlClassName}
            disabled={disabled}
            onBlur={() => {
              field.handleBlur();
            }}
            onChange={(event) => {
              clearActiveDraftError();
              field.handleChange(event.currentTarget.value);
            }}
            placeholder={placeholder}
            value={field.state.value}
          />
        </ComposerFieldRow>
      );
    }}
  </form.Field>
);

export const ComposeSurface = ({
  className,
  demoMode = false,
  initialDraft = null,
  managedDemoMode = false,
  mailboxId,
  onClose,
  onManageTemplates,
  persistDrafts = true,
  senderEmail,
  signature,
  variant = "workspace",
}: ComposeSurfaceProps) => {
  const queryClient = useQueryClient();
  const composeEditorRef = useRef<ComposeEditorHandle | null>(null);
  const [selectedPlaceholder, setSelectedPlaceholder] =
    useState<TemplatePlaceholderRange | null>(null);
  const [activeTemplateName, setActiveTemplateName] =
    useState("Email template");
  const compose = useComposeDialogController({
    demoMode,
    initialDraft,
    mailboxId,
    managedDemoMode,
    onClose,
    onRecipientProblem: focusComposeRecipientField,
    persistDrafts,
    saveOnUnmount: variant === "inline",
    signature,
  });
  const {
    state,
    addInlineImageFiles,
    clearActiveDraftError,
    closeComposeDialog,
    discardActiveDraft,
    form,
    toggleRecipientVisibility,
  } = compose;
  const audioRecorder = useAudioRecorder({
    mimeType: "audio/webm;codecs=opus",
  });
  const transcribeAudioMutation = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const isTranscribingAudio = transcribeAudioMutation.isPending;

  const canEditBody =
    state.draft.saveStatus !== "sending" && hasText(mailboxId);
  const audioBusy = audioRecorder.isRecording || isTranscribingAudio;
  const canSubmitCompose = canEditBody && !audioBusy;
  const isInline = variant === "inline";
  const showSubject =
    !isInline || state.draft.draftAnchor?.seededBy === "forward";
  const [showQuotedContent, setShowQuotedContent] = useState(false);
  const hasQuotedContent =
    isInline && state.draft.bodyHtml.includes("<blockquote");

  const handleRecordingStart = () => {
    if (!canEditBody || isTranscribingAudio) {
      return;
    }

    if (!audioRecorder.isSupported) {
      compose.setActiveDraftError(
        "Audio recording is not supported in this browser."
      );
      return;
    }

    const startRecording = async () => {
      try {
        await audioRecorder.start();
      } catch {
        compose.setActiveDraftError("Could not start recording.");
      }
    };
    void startRecording();
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

        if (mailboxId === null || mailboxId === undefined || mailboxId === "") {
          compose.setActiveDraftError("Select a mailbox before transcribing.");
          return;
        }

        const result = await transcribeAudioMutation.mutateAsync({
          audioBase64: recording.base64,
          durationMs: recording.durationMs,
          format,
          mailboxId,
          mode: "email",
        });
        const currentHtml = normalizeComposeBodyHtml(
          form.state.values.bodyHtml
        );
        const currentText = form.state.values.bodyText.trim();
        const nextText = currentText
          ? `${currentText}\n\n${result.text}`
          : result.text;
        const nextHtml = `${currentHtml}${textToComposeBodyHtml(result.text)}`;

        clearActiveDraftError();
        form.setFieldValue("bodyHtml", nextHtml);
        form.setFieldValue("bodyText", nextText);
      } catch (error) {
        compose.setActiveDraftError(
          error instanceof Error && error.message
            ? error.message
            : "Could not transcribe recording."
        );
      }
    })();
  };

  useHotkey(
    "Mod+Enter",
    (event) => {
      const { target } = event;
      if (
        target instanceof Element &&
        !target.closest("[data-compose-surface]")
      ) {
        return;
      }

      void form.handleSubmit();
    },
    {
      enabled: canSubmitCompose,
      ignoreInputs: false,
    }
  );

  useHotkey(
    "Escape",
    () => {
      closeComposeDialog();
    },
    {
      enabled: state.draft.saveStatus !== "sending",
      ignoreInputs: false,
    }
  );

  return (
    <form
      action={async () => {
        await form.handleSubmit();
      }}
      className={cn("flex min-h-0 flex-col", className, {
        "h-full flex-1": !isInline,
        "w-full": isInline,
      })}
      data-compose-surface
    >
      <ComposerFrame
        className={cn("p-4 sm:p-6", {
          "my-0 max-w-none flex-none p-0 sm:p-0": isInline,
        })}
      >
        <p className="sr-only">
          {getDraftStatusMessage(compose.state.draft, persistDrafts)}
          {hasText(senderEmail) ? `, sending from ${senderEmail}` : ""}
        </p>

        <form.Field name="bodyHtml">
          {(field) => (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <ComposeEditor
                density={isInline ? "compact" : "comfortable"}
                disabled={!canEditBody}
                html={field.state.value}
                onBlur={() => {
                  field.handleBlur();
                }}
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
                <ComposerEditorFrame
                  className={cn({
                    "min-h-64 flex-none": isInline,
                  })}
                >
                  <ComposerFieldGroup className="rounded-none border-0 bg-transparent shadow-none">
                    <form.Field name="to">
                      {(recipientField) => {
                        const [error] = recipientField.state.meta.errors;
                        return (
                          <ComposerFieldRow
                            error={
                              error
                                ? (error.message ?? "Invalid value")
                                : undefined
                            }
                            label="To"
                            trailing={
                              <div className="flex shrink-0 items-center gap-0.5">
                                <Button
                                  aria-controls="compose-cc-field"
                                  aria-expanded={state.showCc}
                                  aria-pressed={state.showCc}
                                  className={cn(
                                    "h-7 px-1.5 text-caption text-muted-fg",
                                    {
                                      "bg-control-active text-fg": state.showCc,
                                    }
                                  )}
                                  onClick={() => {
                                    toggleRecipientVisibility("cc");
                                  }}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Cc
                                </Button>
                                <Button
                                  aria-controls="compose-bcc-field"
                                  aria-expanded={state.showBcc}
                                  aria-pressed={state.showBcc}
                                  className={cn(
                                    "h-7 px-1.5 text-caption text-muted-fg",
                                    {
                                      "bg-control-active text-fg":
                                        state.showBcc,
                                    }
                                  )}
                                  onClick={() => {
                                    toggleRecipientVisibility("bcc");
                                  }}
                                  size="sm"
                                  type="button"
                                  variant="ghost"
                                >
                                  Bcc
                                </Button>
                              </div>
                            }
                          >
                            <FieldControl
                              aria-invalid={!!error}
                              className={composerFieldControlClassName}
                              data-compose-recipient-field
                              disabled={!canEditBody}
                              onBlur={() => {
                                recipientField.handleBlur();
                              }}
                              onChange={(event) => {
                                clearActiveDraftError();
                                recipientField.handleChange(
                                  event.currentTarget.value
                                );
                              }}
                              value={recipientField.state.value}
                            />
                          </ComposerFieldRow>
                        );
                      }}
                    </form.Field>
                    <LazyMotion features={domAnimation} strict>
                      <AnimatePresence initial={false}>
                        {state.showCc ? (
                          <m.div
                            {...composeRecipientMotion}
                            className="grid"
                            id="compose-cc-field"
                            key="compose-cc"
                          >
                            <div className="min-h-0 overflow-hidden">
                              <ComposeFormField
                                clearActiveDraftError={clearActiveDraftError}
                                disabled={!canEditBody}
                                form={form}
                                label="Cc"
                                name="cc"
                              />
                            </div>
                          </m.div>
                        ) : null}
                        {state.showBcc ? (
                          <m.div
                            {...composeRecipientMotion}
                            className="grid"
                            id="compose-bcc-field"
                            key="compose-bcc"
                          >
                            <div className="min-h-0 overflow-hidden">
                              <ComposeFormField
                                clearActiveDraftError={clearActiveDraftError}
                                disabled={!canEditBody}
                                form={form}
                                label="Bcc"
                                name="bcc"
                              />
                            </div>
                          </m.div>
                        ) : null}
                      </AnimatePresence>
                    </LazyMotion>
                    {showSubject ? (
                      <ComposeFormField
                        clearActiveDraftError={clearActiveDraftError}
                        disabled={!canEditBody}
                        form={form}
                        label="Subject"
                        name="subject"
                      />
                    ) : null}
                  </ComposerFieldGroup>

                  <ComposeEditorBody
                    chrome="seamless"
                    className={cn("min-h-0 flex-1", {
                      "[&_.ProseMirror>blockquote]:hidden":
                        hasQuotedContent && !showQuotedContent,
                    })}
                    invalid={field.state.meta.errors.length > 0}
                  />

                  {hasQuotedContent ? (
                    <div className="px-3 pb-1">
                      <IconButtonTooltip
                        label={
                          showQuotedContent
                            ? "Hide quoted message"
                            : "Show quoted message"
                        }
                      >
                        <Button
                          aria-label={
                            showQuotedContent
                              ? "Hide quoted message"
                              : "Show quoted message"
                          }
                          className="h-7 px-2 text-muted-fg"
                          onClick={() => {
                            setShowQuotedContent((current) => !current);
                          }}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          {showQuotedContent ? "Hide quote" : "..."}
                        </Button>
                      </IconButtonTooltip>
                    </div>
                  ) : null}

                  <ComposeEditorToolbar
                    chrome="footer"
                    compact
                    leading={
                      <ToolbarButton
                        className="bg-primary px-3 text-primary-fg shadow-sm hover:bg-primary/90 hover:text-primary-fg active:bg-primary/85 active:text-primary-fg"
                        disabled={!canSubmitCompose}
                        type="submit"
                      >
                        {state.draft.saveStatus === "sending" ? (
                          <HugeiconsIcon
                            className="animate-spin"
                            icon={Loading03Icon}
                          />
                        ) : (
                          <HugeiconsIcon icon={MailSend02Icon} />
                        )}
                        Send
                      </ToolbarButton>
                    }
                    trailing={
                      <>
                        {hasText(mailboxId) ? (
                          <>
                            <ComposeTemplatePicker
                              disabled={!canEditBody || audioBusy}
                              mailboxId={mailboxId}
                              onManage={() => {
                                closeComposeDialog(onManageTemplates);
                              }}
                              onInsert={(template) => {
                                clearActiveDraftError();
                                setActiveTemplateName(template.name);
                                composeEditorRef.current?.insertHtml(
                                  template.bodyHtml
                                );
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
                        <ComposeEditorDictationButton />
                        <IconButtonTooltip
                          label={
                            hasText(state.draft.draftId)
                              ? "Discard draft"
                              : "Discard"
                          }
                        >
                          <ToolbarButton
                            aria-label={
                              hasText(state.draft.draftId)
                                ? "Discard draft"
                                : "Discard"
                            }
                            className="size-8 px-0"
                            disabled={state.draft.saveStatus === "sending"}
                            onClick={() => {
                              discardActiveDraft();
                            }}
                            type="button"
                          >
                            <HugeiconsIcon icon={Delete02Icon} />
                          </ToolbarButton>
                        </IconButtonTooltip>
                        <IconButtonTooltip label="Close composer">
                          <ToolbarButton
                            aria-label="Close composer"
                            className="size-8 px-0"
                            disabled={state.draft.saveStatus === "sending"}
                            onClick={() => {
                              closeComposeDialog();
                            }}
                            type="button"
                          >
                            <HugeiconsIcon icon={Cancel01Icon} />
                          </ToolbarButton>
                        </IconButtonTooltip>
                      </>
                    }
                  />
                </ComposerEditorFrame>

                {field.state.meta.errors.map((error) => (
                  <FieldError
                    key={error?.message ?? "An unknown error occurred."}
                  >
                    {error?.message ?? "An unknown error occurred."}
                  </FieldError>
                ))}
              </ComposeEditor>
            </div>
          )}
        </form.Field>

        {hasText(state.draft.errorMessage) ? (
          <div
            aria-live="polite"
            className="flex min-w-0 shrink-0 items-start gap-2 text-body text-destructive"
            role="alert"
          >
            <HugeiconsIcon
              className="mt-0.5 size-4 shrink-0"
              icon={AlertCircleIcon}
            />
            <span className="min-w-0 wrap-break-word">
              {state.draft.errorMessage}
            </span>
          </div>
        ) : null}
      </ComposerFrame>
    </form>
  );
};

export const ComposeWorkspace = ({
  demoMode,
  mailboxId,
  managedDemoMode,
  onClose,
  onManageTemplates,
  onOpenSidebar,
  persistDrafts,
  senderEmail,
  signature,
}: ComposeWorkspaceProps) => {
  // oxlint-disable-next-line react/hook-use-state -- This one-shot handoff has no state transitions after initialization.
  const [session] = useState(takePendingComposeSession);
  const initialDraft = session?.draft ?? null;

  return (
    <WorkspaceSection data-compose-workspace>
      <div className="flex h-full min-h-0 flex-col">
        <MobileHeader
          className="px-4 sm:px-6"
          leading="sidebar"
          onLeadingClick={onOpenSidebar}
          title="New message"
        />
        <ComposeSurface
          className="flex-1"
          demoMode={demoMode}
          initialDraft={initialDraft}
          mailboxId={mailboxId}
          managedDemoMode={managedDemoMode}
          onClose={onClose}
          onManageTemplates={onManageTemplates}
          persistDrafts={persistDrafts}
          senderEmail={senderEmail}
          signature={signature}
        />
      </div>
    </WorkspaceSection>
  );
};
