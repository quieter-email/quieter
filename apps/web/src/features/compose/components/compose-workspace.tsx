"use client";

import {
  AlertCircleIcon,
  Loading03Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "@quieter/ui/button";
import { Field, FieldControl, FieldError, FieldLabel } from "@quieter/ui/field";
import { ToolbarButton, ToolbarSeparator } from "@quieter/ui/toolbar";
import { useAudioRecorder } from "@tanstack/ai-react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, domAnimation, LazyMotion, m } from "motion/react";
import { useRef, useState } from "react";

import { MobileHeader } from "#/components/mobile-header";
import { WorkspaceSection } from "#/components/workspace-section";
import { USER_BILLING_QUERY_KEY } from "#/features/settings/domain/billing";
import { getTranscriptionAudioFormat } from "#/lib/audio-transcription";
import type { BrowserAudioRecording } from "#/lib/audio-transcription";
import { orpc } from "#/lib/orpc";

import type { ComposeFormValues } from "../domain/compose-form";
import { takePendingComposeSession } from "../domain/compose-session";
import {
  hasComposeDraftContent,
  normalizeComposeBodyHtml,
  textToComposeBodyHtml,
} from "../domain/draft";
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
  getDraftStatusMessage,
  useComposeDialogController,
} from "./use-compose-dialog-controller";
import type { ComposeDialogController } from "./use-compose-dialog-controller";

type ComposeWorkspaceProps = {
  demoMode?: boolean;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onClose: () => void;
  onManageTemplates?: () => void;
  onOpenSidebar: () => void;
  persistDrafts?: boolean;
  senderEmail?: string | null;
  signature?: { html: string | null; text: string | null };
};

type ComposeFormFieldProps = Pick<
  ComposeDialogController,
  "clearActiveDraftError" | "form"
> & {
  disabled?: boolean;
  label: string;
  name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc" | "subject">;
  placeholder?: string;
};

const composeLabelClassName = "w-14 shrink-0 text-sm font-normal text-muted-fg";

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value !== "";

const composeRecipientMotion = {
  animate: { filter: "blur(0px)", gridTemplateRows: "1fr", opacity: 1 },
  exit: { filter: "blur(2px)", gridTemplateRows: "0fr", opacity: 0 },
  initial: { filter: "blur(2px)", gridTemplateRows: "0fr", opacity: 0 },
  transition: { duration: 0.16, ease: "easeOut" },
} as const;

const ComposeFormField = ({
  clearActiveDraftError,
  disabled,
  form,
  label,
  name,
  placeholder,
}: ComposeFormFieldProps) => (
  <form.Field name={name}>
    {(field) => {
      const [error] = field.state.meta.errors;
      return (
        <Field className="gap-1">
          <div className="flex items-center gap-3">
            <FieldLabel className={composeLabelClassName}>{label}</FieldLabel>
            <FieldControl
              aria-invalid={!!error}
              className="min-w-0 flex-1"
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
          </div>
          {error ? (
            <FieldError className="pl-17">
              {error.message ?? "Invalid value"}
            </FieldError>
          ) : null}
        </Field>
      );
    }}
  </form.Field>
);

export const ComposeWorkspace = ({
  demoMode = false,
  managedDemoMode = false,
  mailboxId,
  onClose,
  onManageTemplates,
  onOpenSidebar,
  persistDrafts = true,
  senderEmail,
  signature,
}: ComposeWorkspaceProps) => {
  const queryClient = useQueryClient();
  const composeEditorRef = useRef<ComposeEditorHandle | null>(null);
  const [selectedPlaceholder, setSelectedPlaceholder] =
    useState<TemplatePlaceholderRange | null>(null);
  const [activeTemplateName, setActiveTemplateName] =
    useState("Email template");
  const sessionRef = useRef<ReturnType<
    typeof takePendingComposeSession
  > | null>(null);
  // react-doctor-disable-next-line react-hooks-js/todo -- This one-shot session handoff intentionally uses a lazy ref assignment.
  // react-doctor-disable-next-line react-doctor/no-ref-current-in-render -- The handoff must be consumed once without a second render.
  sessionRef.current ??= takePendingComposeSession() ?? null;
  // react-doctor-disable-next-line react-hooks-js/refs -- The pending session is a one-shot render handoff, not reactive state.
  const session = sessionRef.current;
  // react-doctor-disable-next-line react-hooks-js/refs -- This initial draft is intentionally read once from the one-shot handoff.
  const initialDraft = session?.draft ?? null;
  // react-doctor-disable-next-line react-hooks-js/refs -- The controller receives the one-shot initial draft exactly once.
  const compose = useComposeDialogController({
    demoMode,
    // react-doctor-disable-next-line react-hooks-js/refs -- This value comes from the one-shot compose handoff by design.
    initialDraft,
    mailboxId,
    managedDemoMode,
    onClose,
    persistDrafts,
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
    onComplete: ({ base64, blob, durationMs, mimeType }) =>
      ({
        base64,
        blob,
        durationMs,
        mimeType,
      }) satisfies BrowserAudioRecording,
  });
  const transcribeAudioMutation = useMutation({
    ...orpc.chat.transcribeAudio.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const isTranscribingAudio = transcribeAudioMutation.isPending;

  const hasDraftId =
    state.draft.draftId !== null && state.draft.draftId !== undefined;
  const canDiscardDraft = hasDraftId || hasComposeDraftContent(state.draft);
  const canEditBody =
    state.draft.saveStatus !== "sending" && hasText(mailboxId);
  const audioBusy = audioRecorder.isRecording || isTranscribingAudio;
  const canSubmitCompose = canEditBody && !audioBusy;

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
        !target.closest("[data-compose-workspace]")
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
    <WorkspaceSection data-compose-workspace>
      <form
        action={async () => {
          await form.handleSubmit();
        }}
        className="flex h-full min-h-0 flex-col"
      >
        <MobileHeader
          className="px-4 sm:px-6"
          leading="sidebar"
          onLeadingClick={onOpenSidebar}
          title="New message"
        />
        {/* A writing measure, not the full workspace width. */}
        <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-4 p-6 sm:gap-5 sm:p-8">
          <p className="sr-only">
            {getDraftStatusMessage(compose.state.draft, persistDrafts)}
          </p>

          <div className="flex w-full shrink-0 flex-col gap-2 border-b border-border pb-4 sm:pb-5">
            {hasText(senderEmail) ? (
              <Field className="gap-1">
                <div className="flex items-center gap-3">
                  <FieldLabel className={composeLabelClassName}>
                    From
                  </FieldLabel>
                  <FieldControl
                    className="min-w-0 flex-1"
                    readOnly
                    value={senderEmail}
                  />
                </div>
              </Field>
            ) : null}
            <div>
              <form.Field name="to">
                {(field) => {
                  const [error] = field.state.meta.errors;
                  return (
                    <Field className="gap-1">
                      <div className="flex items-center gap-3">
                        <FieldLabel className={composeLabelClassName}>
                          To
                        </FieldLabel>
                        <div className="flex min-w-0 flex-1 items-center gap-2">
                          <FieldControl
                            aria-invalid={!!error}
                            className="min-w-0 flex-1"
                            disabled={!canEditBody}
                            onBlur={() => {
                              field.handleBlur();
                            }}
                            onChange={(event) => {
                              clearActiveDraftError();
                              field.handleChange(event.currentTarget.value);
                            }}
                            value={field.state.value}
                          />
                          <Button
                            aria-controls="compose-cc-field"
                            aria-expanded={state.showCc}
                            aria-pressed={state.showCc}
                            className={
                              state.showCc
                                ? "border-border bg-bg-elevated text-fg shadow-sm hover:bg-bg-elevated"
                                : undefined
                            }
                            onClick={() => {
                              toggleRecipientVisibility("cc");
                            }}
                            type="button"
                            variant={state.showCc ? "outline" : "ghost"}
                          >
                            Cc
                          </Button>
                          <Button
                            aria-controls="compose-bcc-field"
                            aria-expanded={state.showBcc}
                            aria-pressed={state.showBcc}
                            className={
                              state.showBcc
                                ? "border-border bg-bg-elevated text-fg shadow-sm hover:bg-bg-elevated"
                                : undefined
                            }
                            onClick={() => {
                              toggleRecipientVisibility("bcc");
                            }}
                            type="button"
                            variant={state.showBcc ? "outline" : "ghost"}
                          >
                            Bcc
                          </Button>
                        </div>
                      </div>
                      {error ? (
                        <FieldError className="pl-17">
                          {error.message ?? "Invalid value"}
                        </FieldError>
                      ) : null}
                    </Field>
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
                        <div className="pt-2">
                          <ComposeFormField
                            clearActiveDraftError={clearActiveDraftError}
                            disabled={!canEditBody}
                            form={form}
                            label="Cc"
                            name="cc"
                          />
                        </div>
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
                        <div className="pt-2">
                          <ComposeFormField
                            clearActiveDraftError={clearActiveDraftError}
                            disabled={!canEditBody}
                            form={form}
                            label="Bcc"
                            name="bcc"
                          />
                        </div>
                      </div>
                    </m.div>
                  ) : null}
                </AnimatePresence>
              </LazyMotion>
            </div>
            <ComposeFormField
              clearActiveDraftError={clearActiveDraftError}
              disabled={!canEditBody}
              form={form}
              label="Subject"
              name="subject"
            />
          </div>

          <form.Field name="bodyHtml">
            {(field) => (
              <Field className="flex min-h-0 flex-1 flex-col gap-2">
                <FieldLabel className="font-normal text-muted-fg">
                  Message
                </FieldLabel>
                <ComposeEditor
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
                  <div className="flex min-h-0 flex-1 flex-col gap-2">
                    {/* One frame: the toolbar belongs to the editor, not beside it. */}
                    <div className="squircle flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-border shadow-sm">
                      <ComposeEditorBody
                        className="min-h-0 flex-1 rounded-none border-0 shadow-none"
                        invalid={field.state.meta.errors.length > 0}
                      />
                      <ComposeEditorToolbar
                        className="rounded-none border-0 border-t border-border shadow-none"
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
                            {canDiscardDraft ? (
                              <ToolbarButton
                                disabled={state.draft.saveStatus === "sending"}
                                onClick={() => {
                                  discardActiveDraft();
                                }}
                                type="button"
                              >
                                {hasText(state.draft.draftId)
                                  ? "Discard draft"
                                  : "Discard"}
                              </ToolbarButton>
                            ) : null}
                            <ToolbarSeparator />
                            <ToolbarButton
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
                          </>
                        }
                      />
                    </div>
                    {field.state.meta.errors.map((error) => (
                      <FieldError
                        key={error?.message ?? "An unknown error occurred."}
                      >
                        {error?.message ?? "An unknown error occurred."}
                      </FieldError>
                    ))}
                  </div>
                </ComposeEditor>
              </Field>
            )}
          </form.Field>

          {hasText(state.draft.errorMessage) ? (
            <div
              aria-live="polite"
              className="flex min-w-0 shrink-0 items-start gap-2 text-sm text-destructive"
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
        </div>
      </form>
    </WorkspaceSection>
  );
};
