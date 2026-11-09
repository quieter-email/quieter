"use client";

import {
  AlertCircleIcon,
  ArrowDown01Icon,
  Attachment01Icon,
  Cancel01Icon,
  Delete02Icon,
  Loading03Icon,
  MailSend02Icon,
} from "@hugeicons/core-free-icons";
import {
  ComposeEditor,
  ComposeEditorBody,
  ComposeEditorDictationButton,
  ComposeEditorToolbar,
} from "@quieter/app/features/compose/components/compose-editor";
import type { ComposeEditorHandle } from "@quieter/app/features/compose/components/compose-editor";
import { SaveSnippetDialog } from "@quieter/app/features/compose/components/save-snippet-dialog";
import {
  getDraftStatusMessage,
  useComposeDialogController,
} from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import type { ComposeDialogController } from "@quieter/app/features/compose/components/use-compose-dialog-controller";
import type { ComposeFormValues } from "@quieter/app/features/compose/domain/compose-form";
import {
  appendComposeSignature,
  deleteComposeDraft,
  hasComposeDraftContent,
  normalizeComposeBodyHtml,
  prepareLoadedComposeDraft,
  clearComposeDraftRuntimeFiles,
  createRecoveredComposeCopy,
  createEmptyComposeDraft,
  loadComposeRuntimeFile,
  textToComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { findRecoverableComposeDraft } from "@quieter/app/features/compose/domain/draft-recovery";
import { MailSubviewHeader } from "@quieter/app/features/mailbox/components/mail-subview-header";
import {
  appEaseOut,
  appMotionDuration,
  getAppPresenceMotion,
} from "@quieter/app/features/motion/app-motion";
import { ComposeFollowUp } from "@quieter/app/features/reminders/compose-follow-up";
import { USER_BILLING_QUERY_KEY } from "@quieter/app/features/settings/domain/billing";
import { useAudioRecorder } from "@quieter/app/lib/audio-recorder";
import {
  MAX_TRANSCRIPTION_AUDIO_DURATION_MS,
  prepareTranscriptionRecording,
} from "@quieter/app/lib/audio-transcription";
import { authClient } from "@quieter/app/lib/auth";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { toastError } from "@quieter/app/lib/error-toast";
import { deleteDemoDraft } from "@quieter/app/lib/gmail/demo-mail";
import {
  MESSAGE_ATTACHMENT_DRAG_TYPE,
  openAttachmentPreview,
  readMessageAttachmentDrop,
} from "@quieter/app/lib/mail/attachments";
import { refreshCachedMailboxQueries } from "@quieter/app/lib/mail/inbox-query/index";
import { deleteManagedDemoDraft } from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { orpc, rpc } from "@quieter/app/lib/orpc";
import { resolveMailSender } from "@quieter/mail/compose/sender";
import type { MailboxCapabilities } from "@quieter/mail/data-plane";
import type { RouterInputs } from "@quieter/orpc";
import { ActionFooter } from "@quieter/ui/action-footer";
import { Button } from "@quieter/ui/button";
import { cn } from "@quieter/ui/cn";
import {
  ComposerEditorFrame,
  ComposerFieldGroup,
  ComposerFieldRow,
  ComposerFrame,
} from "@quieter/ui/composer-chrome";
import {
  Dialog,
  DialogBody,
  DialogCloseButton,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@quieter/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@quieter/ui/dropdown-menu";
import { Field, FieldControl, FieldError, FieldLabel } from "@quieter/ui/field";
import { Icon } from "@quieter/ui/icon";
import { IconButtonTooltip } from "@quieter/ui/icon-button-tooltip";
import { entranceMotionVariants } from "@quieter/ui/motion";
import {
  Popover,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "@quieter/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@quieter/ui/select";
import { Text } from "@quieter/ui/text";
import { ToolbarButton } from "@quieter/ui/toolbar";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AnimatePresence,
  domAnimation,
  LazyMotion,
  m,
  useReducedMotion,
} from "motion/react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

export type ComposeSenderMailbox = {
  capabilities: Pick<MailboxCapabilities, "canSetSenderName">;
  id: string;
  emailAddress: string;
  displayName: string | null;
  signatureHtml?: string | null;
  signatureText?: string | null;
};

export type ComposeSurfaceProps = {
  allowSenderSwitch?: boolean;
  beforeNavigate?: () => Promise<void>;
  actionDraft?: ComposeDraftState | null;
  className?: string;
  demoMode?: boolean;
  initialDraft?: ComposeDraftState | null;
  initialDraftNeedsSave?: boolean;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onClose: () => void;
  onManageSnippets?: () => void;
  onOpenSidebar?: () => void;
  onSenderSwitch?: (
    mailboxId: string,
    currentDraft: ComposeDraftState,
    transferDraft: ComposeDraftState,
    hasAuthoredContent: boolean
  ) => Promise<void> | void;
  persistDrafts?: boolean;
  senderEmail?: string | null;
  senderMailbox?: ComposeSenderMailbox | null;
  senderMailboxes?: ComposeSenderMailbox[];
  senderUnavailable?: boolean;
  signature?: { html: string | null; text: string | null };
  variant?: "inline" | "workspace";
};

type ComposeWorkspaceProps = Omit<
  ComposeSurfaceProps,
  "className" | "variant"
> & {
  onOpenSidebar: () => void;
  onSwitchSenderMailbox?: (mailboxId: string) => Promise<void>;
};

type ComposeFormFieldProps = Pick<
  ComposeDialogController,
  "handleUserDraftChange" | "form"
> & {
  disabled?: boolean;
  label: string;
  name: keyof Pick<ComposeFormValues, "to" | "cc" | "bcc" | "subject">;
  placeholder?: string;
};

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
  handleUserDraftChange,
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
        <ComposerFieldRow
          error={error ? (error.message ?? "Invalid value") : undefined}
          label={label}
        >
          <FieldControl
            aria-invalid={!!error}
            chrome="composer"
            disabled={disabled}
            onBlur={() => {
              field.handleBlur();
            }}
            onChange={(event) => {
              handleUserDraftChange();
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

const RenameAttachmentDialog = ({
  attachment,
  disabled,
  onClose,
  onSave,
}: {
  attachment: ComposeDraftState["attachments"][number];
  disabled: boolean;
  onClose: () => void;
  onSave: (id: string, name: string) => void;
}) => {
  const [name, setName] = useState(attachment.name);
  const valid = !!name.trim() && !/[\r\n\0]/u.test(name);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !disabled) {
              onSave(attachment.id, name);
              onClose();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename attachment</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field>
              <FieldLabel htmlFor="attachment-name">File name</FieldLabel>
              <FieldControl
                disabled={disabled}
                id="attachment-name"
                onChange={(event) => {
                  setName(event.currentTarget.value);
                }}
                value={name}
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <DialogCloseButton>Cancel</DialogCloseButton>
            <Button disabled={!valid || disabled} type="submit">
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const ReadyComposeSurface = ({
  allowSenderSwitch = false,
  beforeNavigate,
  actionDraft,
  className,
  demoMode = false,
  initialDraft = null,
  initialDraftNeedsSave = false,
  managedDemoMode = false,
  mailboxId,
  onClose,
  onManageSnippets,
  onOpenSidebar,
  onSenderSwitch,
  persistDrafts = true,
  senderEmail,
  senderMailbox,
  senderMailboxes,
  senderUnavailable = false,
  signature,
  variant = "workspace",
}: ComposeSurfaceProps) => {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const composeEditorRef = useRef<ComposeEditorHandle | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const mountedRef = useRef(false);
  const modKeyLabel = useSyncExternalStore(
    () => () => {
      // The operating system has no change event during this page's lifetime.
    },
    () => (/Mac|iPhone|iPad|iPod/u.test(navigator.platform) ? "⌘" : "Ctrl"),
    () => "Ctrl"
  );
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const [snippetDraft, setSnippetDraft] = useState<string | null>(null);
  const [switchingSender, setSwitchingSender] = useState(false);
  const [senderDetailsOpen, setSenderDetailsOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [renamingAttachment, setRenamingAttachment] = useState<
    ComposeDraftState["attachments"][number] | null
  >(null);
  const currentSender =
    senderMailboxes?.find((sender) => sender.id === mailboxId) ??
    senderMailbox ??
    undefined;
  const editableSender =
    currentSender?.capabilities.canSetSenderName === true
      ? resolveMailSender(currentSender)
      : undefined;
  const snippetsQuery = useQuery({
    ...orpc.mailSnippets.list.queryOptions({
      input: { mailboxId: mailboxId ?? "" },
    }),
    enabled: !!mailboxId && !demoMode && !managedDemoMode,
  });
  let snippetStatus: string | undefined;
  if (snippetsQuery.isError) {
    snippetStatus = "Could not load snippets. Reopen the composer to retry.";
  } else if (snippetsQuery.isFetching) {
    snippetStatus = "Loading snippets…";
  }
  const compose = useComposeDialogController({
    autosavePaused: slashMenuOpen || switchingSender,
    beforeNavigate,
    defaultSenderName: editableSender?.name,
    demoMode,
    editorReady,
    getTextFromHtml: (html) =>
      composeEditorRef.current?.getTextFromHtml(html) ??
      new DOMParser().parseFromString(html, "text/html").body.textContent ??
      "",
    initialDraft,
    initialDraftNeedsSave,
    mailboxId,
    managedDemoMode,
    normalizeHtml: (html) =>
      composeEditorRef.current?.normalizeHtml(html) ?? html,
    onClose,
    onRecipientProblem: focusComposeRecipientField,
    persistDrafts,
    signature,
  });
  const changeAction = useEffectEvent((next: ComposeDraftState) => {
    void compose.changeComposeAction(next);
  });
  useEffect(() => {
    if (actionDraft) {
      changeAction(actionDraft);
    }
  }, [actionDraft]);
  const {
    state,
    addInlineImageFiles,
    addAttachmentFiles,
    addMessageAttachment,
    removeAttachment,
    renameAttachment,
    handleUserDraftChange,
    closeComposeDialog,
    discardActiveDraft,
    form,
    toggleRecipientVisibility,
  } = compose;
  const audioRecorder = useAudioRecorder();
  const audioSessionRef = useRef<AbortController | null>(null);
  const transcribeAudioMutation = useMutation({
    mutationFn: async ({
      input,
      signal,
    }: {
      input: RouterInputs["chat"]["transcribeAudio"];
      signal: AbortSignal;
    }) => await rpc.chat.transcribeAudio(input, { signal }),
    mutationKey: [
      ...orpc.chat.transcribeAudio.mutationKey(),
      mailboxId,
      state.draft.localId,
    ],
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: USER_BILLING_QUERY_KEY });
    },
  });
  const [isTranscribingAudio, setIsTranscribingAudio] = useState(false);
  const cancelAudioRecording = audioRecorder.cancel;
  useLayoutEffect(
    () => () => {
      audioSessionRef.current?.abort();
      audioSessionRef.current = null;
      cancelAudioRecording();
      setIsTranscribingAudio(false);
    },
    [cancelAudioRecording, mailboxId, state.draft.localId, state.open]
  );

  const canEditBody =
    state.open &&
    state.draft.saveStatus !== "sending" &&
    state.draft.sendUncertain !== true &&
    !state.isFinishing &&
    !switchingSender &&
    !!mailboxId;
  const audioBusy =
    audioRecorder.isStarting ||
    audioRecorder.isRecording ||
    isTranscribingAudio;
  const canSubmitCompose =
    ((canEditBody && !senderUnavailable) ||
      (state.open &&
        state.draft.sendUncertain === true &&
        state.draft.saveStatus !== "sending" &&
        !state.isFinishing &&
        !switchingSender &&
        !!mailboxId)) &&
    !audioBusy;
  const isInline = variant === "inline";
  const canSwitchSender =
    !isInline &&
    allowSenderSwitch &&
    !!onSenderSwitch &&
    !!mailboxId &&
    senderMailboxes !== undefined &&
    (currentSender === undefined
      ? senderUnavailable && senderMailboxes.length > 0
      : senderMailboxes.length > 1);
  const showSubject =
    !isInline || state.draft.draftAnchor?.seededBy === "forward";
  const [showQuotedContent, setShowQuotedContent] = useState(false);
  const hasQuotedContent =
    isInline && state.draft.bodyHtml.includes("<blockquote");

  const openComposeAttachment = async (
    attachment: ComposeDraftState["attachments"][number]
  ) => {
    if (!mailboxId) {
      return;
    }
    try {
      await openAttachmentPreview({
        fileName: attachment.name,
        loadFile: async () => {
          const loaded = await loadComposeRuntimeFile(
            attachment,
            mailboxId,
            state.draft.messageId
          );
          return loaded.file;
        },
      });
    } catch (error) {
      toastError(error, {
        boundary: "compose-attachment-preview",
        fallback: "Could not open that attachment. Please try again.",
      });
    }
  };

  const handleSenderChange = async (nextMailboxId: string | null) => {
    if (
      !nextMailboxId ||
      nextMailboxId === mailboxId ||
      senderMailboxes?.some((sender) => sender.id === nextMailboxId) !== true ||
      switchingSender
    ) {
      return;
    }
    setSwitchingSender(true);
    let preparedTransfer: ComposeDraftState | null = null;
    let senderTransferred = false;
    try {
      const drafts = await compose.prepareSenderSwitch(senderUnavailable);
      if (drafts) {
        preparedTransfer = drafts.transferDraft;
        const nextSender = senderMailboxes?.find(
          (sender) => sender.id === nextMailboxId
        );
        let { transferDraft } = drafts;
        let hasAuthoredContent = hasComposeDraftContent(transferDraft);
        const document = new DOMParser().parseFromString(
          transferDraft.bodyHtml,
          "text/html"
        );
        const automaticSignature = document.body.querySelector(
          '[data-quieter-signature="true"]'
        );
        if (automaticSignature) {
          const signatureCandidates = [
            signature?.text?.trim(),
            automaticSignature.textContent?.trim(),
          ].filter((value): value is string => !!value);
          automaticSignature.remove();
          let bodyText = transferDraft.bodyText.trimEnd();
          const matchedSignature = signatureCandidates.find((candidate) =>
            bodyText.endsWith(candidate)
          );
          if (matchedSignature) {
            bodyText = bodyText.slice(0, -matchedSignature.length).trimEnd();
          } else {
            bodyText = document.body.textContent?.trim() ?? "";
          }
          const withoutSignature = {
            ...transferDraft,
            bodyHtml: document.body.innerHTML,
            bodyText,
          };
          hasAuthoredContent = hasComposeDraftContent(withoutSignature);
          transferDraft = withoutSignature;
        }
        transferDraft = appendComposeSignature(transferDraft, {
          html: nextSender?.signatureHtml ?? null,
          text: nextSender?.signatureText ?? null,
        });
        compose.allowSenderRouteChange(nextMailboxId);
        await onSenderSwitch?.(
          nextMailboxId,
          drafts.currentDraft,
          transferDraft,
          hasAuthoredContent
        );
        senderTransferred = true;
        await compose.completeSenderSwitch();
      } else {
        setSwitchingSender(false);
      }
    } catch (error) {
      if (!senderTransferred && preparedTransfer) {
        clearComposeDraftRuntimeFiles(preparedTransfer);
      }
      setSwitchingSender(false);
      toastError(error, {
        boundary: "compose-switch-sender",
        fallback: "Could not change the sending address. Please try again.",
      });
    } finally {
      compose.clearSenderRouteChange();
    }
  };

  const handleRecordingStart = () => {
    if (!canEditBody || audioBusy) {
      return;
    }

    audioSessionRef.current?.abort();
    const session = new AbortController();
    audioSessionRef.current = session;
    void (async () => {
      try {
        await audioRecorder.start();
      } catch (error) {
        if (mountedRef.current && !session.signal.aborted) {
          toastError(error, { boundary: "compose-microphone" });
        }
        if (audioSessionRef.current === session) {
          audioSessionRef.current = null;
        }
      }
    })();
  };

  const handleRecordingCancel = () => {
    audioSessionRef.current?.abort();
    audioSessionRef.current = null;
    audioRecorder.cancel();
    setIsTranscribingAudio(false);
  };

  const handleRecordingStop = () => {
    const session = audioSessionRef.current;
    if (session === null || !audioRecorder.isRecording || isTranscribingAudio) {
      return;
    }
    setIsTranscribingAudio(true);
    void (async () => {
      try {
        const clip = await audioRecorder.stop();
        if (!mountedRef.current || session.signal.aborted) {
          return;
        }
        const recording = await prepareTranscriptionRecording(clip);
        if (!mountedRef.current || session.signal.aborted) {
          return;
        }
        if (mailboxId === null || mailboxId === undefined || mailboxId === "") {
          compose.setActiveDraftError("Select a mailbox before transcribing.");
          return;
        }

        const result = await transcribeAudioMutation.mutateAsync({
          input: { ...recording, mailboxId, mode: "email" },
          signal: session.signal,
        });
        if (!mountedRef.current || session.signal.aborted) {
          return;
        }
        const currentHtml = normalizeComposeBodyHtml(
          form.state.values.bodyHtml
        );
        const currentText = form.state.values.bodyText.trim();
        const nextText = currentText
          ? `${currentText}\n\n${result.text}`
          : result.text;
        const nextHtml = `${currentHtml}${textToComposeBodyHtml(result.text)}`;

        handleUserDraftChange();
        form.setFieldValue("bodyHtml", nextHtml);
        form.setFieldValue("bodyText", nextText);
      } catch (error) {
        if (!mountedRef.current || session.signal.aborted) {
          return;
        }
        toastError(error, {
          boundary: "compose-transcription",
          fallback: "Could not transcribe recording. Please try again.",
        });
        compose.setActiveDraftError(
          "Could not transcribe recording. Please try again."
        );
      } finally {
        if (audioSessionRef.current === session) {
          audioSessionRef.current = null;
          if (mountedRef.current) {
            setIsTranscribingAudio(false);
          }
        }
      }
    })();
  };

  const finishRecording = useEffectEvent(handleRecordingStop);
  useEffect(() => {
    const timer = audioRecorder.isRecording
      ? window.setTimeout(() => {
          finishRecording();
        }, MAX_TRANSCRIPTION_AUDIO_DURATION_MS - 500)
      : undefined;
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [audioRecorder.isRecording]);

  useHotkey(
    "Mod+Enter",
    (event) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="listbox"][id^="compose-commands-"]')
      ) {
        return;
      }
      const { target } = event;
      if (
        target instanceof Element &&
        !target.closest("[data-compose-surface]")
      ) {
        return;
      }

      if (state.draft.sendUncertain === true) {
        void compose.checkSendDelivery();
      } else {
        void form.handleSubmit();
      }
    },
    {
      enabled: canSubmitCompose,
      ignoreInputs: false,
    }
  );

  useHotkey(
    "Escape",
    (event) => {
      if (
        event.defaultPrevented ||
        document.querySelector('[role="listbox"][id^="compose-commands-"]') ||
        snippetDraft !== null ||
        switchingSender ||
        (event.target instanceof Element &&
          !!event.target.closest('[role="dialog"]'))
      ) {
        return;
      }
      void closeComposeDialog();
    },
    {
      enabled: state.draft.saveStatus !== "sending" && !switchingSender,
      ignoreInputs: false,
    }
  );

  return (
    <>
      {isInline ? null : (
        <MailSubviewHeader
          className="px-4 pt-4 sm:px-6 sm:pt-6"
          closeAction={{
            disabled:
              !state.open ||
              state.isFinishing ||
              state.draft.saveStatus === "sending" ||
              switchingSender,
            label: "Close composer",
            onClick: () => {
              void closeComposeDialog();
            },
          }}
          onOpenSidebar={onOpenSidebar}
          title="New message"
        />
      )}
      <form
        action={async () => {
          if (canSubmitCompose) {
            await form.handleSubmit();
          }
        }}
        className={cn("flex min-h-0 flex-col", className, {
          "h-full flex-1": !isInline,
          "w-full": isInline,
        })}
        data-compose-surface
        onDragEnterCapture={(event) => {
          if (
            event.dataTransfer.types.includes("Files") ||
            event.dataTransfer.types.includes(MESSAGE_ATTACHMENT_DRAG_TYPE)
          ) {
            dragDepthRef.current += 1;
            setIsDraggingFiles(true);
          }
        }}
        onDragLeaveCapture={(event) => {
          if (
            event.dataTransfer.types.includes("Files") ||
            event.dataTransfer.types.includes(MESSAGE_ATTACHMENT_DRAG_TYPE)
          ) {
            dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
            if (dragDepthRef.current === 0) {
              setIsDraggingFiles(false);
            }
          }
        }}
        onDragOverCapture={(event) => {
          if (
            event.dataTransfer.types.includes("Files") ||
            event.dataTransfer.types.includes(MESSAGE_ATTACHMENT_DRAG_TYPE)
          ) {
            event.preventDefault();
            event.dataTransfer.dropEffect = canEditBody ? "copy" : "none";
          }
        }}
        onDropCapture={(event) => {
          if (
            !event.dataTransfer.types.includes("Files") &&
            !event.dataTransfer.types.includes(MESSAGE_ATTACHMENT_DRAG_TYPE)
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          dragDepthRef.current = 0;
          setIsDraggingFiles(false);
          if (canEditBody) {
            if (
              event.dataTransfer.types.includes(MESSAGE_ATTACHMENT_DRAG_TYPE)
            ) {
              const source = readMessageAttachmentDrop(
                event.dataTransfer,
                mailboxId
              );
              if (source) {
                addMessageAttachment(source.attachment, source.messageId);
              }
            } else {
              addAttachmentFiles([...event.dataTransfer.files]);
            }
          }
        }}
      >
        <input
          aria-label="Choose attachments"
          className="hidden"
          disabled={!canEditBody}
          multiple
          onChange={(event) => {
            addAttachmentFiles([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
          ref={attachmentInputRef}
          type="file"
        />
        <ComposerFrame layout={isInline ? "inline" : "default"}>
          <p className="sr-only">
            {getDraftStatusMessage(compose.state.draft, persistDrafts)}
            {senderEmail ? `, sending from ${senderEmail}` : ""}
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
                      text !== form.state.values.bodyText ||
                      normalizeComposeBodyHtml(html) !==
                        normalizeComposeBodyHtml(field.state.value)
                    ) {
                      handleUserDraftChange();
                    }
                    field.handleChange(html);
                    form.setFieldValue("bodyText", text);
                  }}
                  onInlineImageFiles={addInlineImageFiles}
                  onReadyChange={setEditorReady}
                  onSlashMenuOpenChange={setSlashMenuOpen}
                  snippets={snippetsQuery.data?.snippets}
                  snippetStatus={snippetStatus}
                  onCreateSnippet={
                    mailboxId && !demoMode && !managedDemoMode
                      ? setSnippetDraft
                      : undefined
                  }
                  onManageSnippets={
                    onManageSnippets
                      ? () => {
                          void closeComposeDialog(onManageSnippets);
                        }
                      : undefined
                  }
                  onRecordingStart={handleRecordingStart}
                  onRecordingStop={handleRecordingStop}
                  onRecordingCancel={handleRecordingCancel}
                  recording={audioRecorder.isRecording}
                  recordingAnalyser={audioRecorder.analyser}
                  recordingStarting={audioRecorder.isStarting}
                  recordingSupported={audioRecorder.isSupported}
                  ref={composeEditorRef}
                  transcribing={isTranscribingAudio}
                >
                  <ComposerEditorFrame
                    className={cn("@container", {
                      "min-h-64 flex-none": isInline,
                    })}
                  >
                    <ComposerFieldGroup bare>
                      {canSwitchSender || editableSender ? (
                        <form.Field name="senderName">
                          {(senderField) => {
                            const [error] = senderField.state.meta.errors;
                            const senderName = editableSender
                              ? senderField.state.value.trim() ||
                                editableSender.name
                              : "";
                            return (
                              <ComposerFieldRow
                                error={
                                  senderDetailsOpen ? undefined : error?.message
                                }
                                label="From"
                              >
                                <div className="flex h-10 min-w-0 flex-1 items-center">
                                  <Popover
                                    onOpenChange={setSenderDetailsOpen}
                                    open={senderDetailsOpen}
                                  >
                                    <PopoverTrigger
                                      aria-label={`Edit sender, ${senderName ? `${senderName}, ` : ""}${senderEmail ?? "choose an address"}`}
                                      disabled={
                                        !canEditBody ||
                                        audioBusy ||
                                        state.draft.saveStatus === "saving"
                                      }
                                      render={
                                        <Button
                                          className="max-w-full min-w-0 shrink justify-start"
                                          chrome="toolbar"
                                          size="field"
                                          variant="secondary"
                                        />
                                      }
                                    >
                                      {senderName ? (
                                        <span className="max-w-1/2 shrink-0 truncate text-fg">
                                          {senderName}
                                        </span>
                                      ) : null}
                                      <span className="truncate">
                                        {senderName && senderEmail
                                          ? `<${senderEmail}>`
                                          : (senderEmail ??
                                            "Choose a sending address")}
                                      </span>
                                      <Icon
                                        aria-hidden
                                        data-icon="inline-end"
                                        icon={ArrowDown01Icon}
                                      />
                                    </PopoverTrigger>
                                    <PopoverContent
                                      align="start"
                                      aria-label="Edit sender"
                                      size="sm"
                                    >
                                      <div className="flex flex-col gap-4">
                                        {canSwitchSender ? (
                                          <Field>
                                            <FieldLabel>
                                              Sending address
                                            </FieldLabel>
                                            <Select
                                              items={[
                                                ...(senderMailboxes?.map(
                                                  (sender) => ({
                                                    label: sender.displayName
                                                      ? `${sender.displayName} <${sender.emailAddress}>`
                                                      : sender.emailAddress,
                                                    value: sender.id,
                                                  })
                                                ) ?? []),
                                                ...(currentSender ===
                                                  undefined && mailboxId
                                                  ? [
                                                      {
                                                        label: `${senderEmail ?? "Account"} (unavailable)`,
                                                        value: mailboxId,
                                                      },
                                                    ]
                                                  : []),
                                              ]}
                                              onValueChange={(
                                                nextMailboxId
                                              ) => {
                                                void handleSenderChange(
                                                  nextMailboxId
                                                );
                                              }}
                                              value={mailboxId}
                                            >
                                              <SelectTrigger
                                                aria-label="Sending address"
                                                className="w-full"
                                                disabled={
                                                  !canEditBody ||
                                                  audioBusy ||
                                                  state.draft.saveStatus ===
                                                    "saving"
                                                }
                                                pending={switchingSender}
                                              >
                                                <SelectValue>
                                                  {senderEmail ??
                                                    "Choose a sending address"}
                                                </SelectValue>
                                              </SelectTrigger>
                                              <SelectContent
                                                align="start"
                                                className="max-w-(--available-width)"
                                              >
                                                <SelectGroup>
                                                  {currentSender ===
                                                    undefined && mailboxId ? (
                                                    <SelectItem
                                                      value={mailboxId}
                                                    >
                                                      {senderEmail ?? "Account"}{" "}
                                                      (unavailable)
                                                    </SelectItem>
                                                  ) : null}
                                                  {senderMailboxes?.map(
                                                    (sender) => (
                                                      <SelectItem
                                                        key={sender.id}
                                                        value={sender.id}
                                                      >
                                                        <span className="flex min-w-0 flex-col gap-0.5 py-1">
                                                          <span className="truncate text-body-sm font-medium">
                                                            {sender.displayName ||
                                                              sender.emailAddress}
                                                          </span>
                                                          {sender.displayName ? (
                                                            <span className="text-caption break-all text-muted-fg">
                                                              {
                                                                sender.emailAddress
                                                              }
                                                            </span>
                                                          ) : null}
                                                        </span>
                                                      </SelectItem>
                                                    )
                                                  )}
                                                </SelectGroup>
                                              </SelectContent>
                                            </Select>
                                          </Field>
                                        ) : null}
                                        {editableSender ? (
                                          <Field invalid={!!error}>
                                            <FieldLabel>Sender name</FieldLabel>
                                            <FieldControl
                                              aria-invalid={!!error}
                                              disabled={!canEditBody}
                                              onBlur={senderField.handleBlur}
                                              onChange={(event) => {
                                                handleUserDraftChange();
                                                senderField.handleChange(
                                                  event.currentTarget.value
                                                );
                                              }}
                                              onKeyDown={(event) => {
                                                if (event.key === "Enter") {
                                                  event.preventDefault();
                                                  if (!error) {
                                                    setSenderDetailsOpen(false);
                                                  }
                                                }
                                              }}
                                              placeholder={editableSender.name}
                                              value={senderField.state.value}
                                            />
                                            {error ? (
                                              <FieldError>
                                                {error.message}
                                              </FieldError>
                                            ) : null}
                                          </Field>
                                        ) : null}
                                        <ActionFooter>
                                          <PopoverClose
                                            disabled={!!error}
                                            render={<Button />}
                                          >
                                            Save
                                          </PopoverClose>
                                        </ActionFooter>
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                </div>
                              </ComposerFieldRow>
                            );
                          }}
                        </form.Field>
                      ) : null}
                      {!canSwitchSender &&
                      !editableSender &&
                      !isInline &&
                      senderMailboxes &&
                      senderEmail ? (
                        <ComposerFieldRow label="From">
                          <FieldControl
                            chrome="composer"
                            readOnly
                            tabIndex={-1}
                            value={senderEmail}
                          />
                        </ComposerFieldRow>
                      ) : null}
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
                                <div className="flex shrink-0 items-center gap-2">
                                  <Button
                                    chrome="toolbar"
                                    aria-controls="compose-cc-field"
                                    aria-expanded={state.showCc}
                                    aria-pressed={state.showCc}
                                    onClick={() => {
                                      toggleRecipientVisibility("cc");
                                    }}
                                    type="button"
                                    size="field"
                                    variant="secondary"
                                  >
                                    Cc
                                  </Button>
                                  <Button
                                    chrome="toolbar"
                                    aria-controls="compose-bcc-field"
                                    aria-expanded={state.showBcc}
                                    aria-pressed={state.showBcc}
                                    onClick={() => {
                                      toggleRecipientVisibility("bcc");
                                    }}
                                    type="button"
                                    size="field"
                                    variant="secondary"
                                  >
                                    Bcc
                                  </Button>
                                </div>
                              }
                            >
                              <FieldControl
                                aria-invalid={!!error}
                                chrome="composer"
                                data-compose-recipient-field
                                disabled={!canEditBody}
                                placeholder="Add recipients"
                                onBlur={() => {
                                  recipientField.handleBlur();
                                }}
                                onChange={(event) => {
                                  handleUserDraftChange();
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
                                  handleUserDraftChange={handleUserDraftChange}
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
                                  handleUserDraftChange={handleUserDraftChange}
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
                          handleUserDraftChange={handleUserDraftChange}
                          disabled={!canEditBody}
                          form={form}
                          label="Subject"
                          name="subject"
                          placeholder="Add a subject"
                        />
                      ) : null}
                    </ComposerFieldGroup>

                    <ComposeEditorBody
                      chrome="seamless"
                      className={cn("flex-1", {
                        "[&_.ProseMirror>blockquote]:hidden":
                          hasQuotedContent && !showQuotedContent,
                      })}
                      invalid={field.state.meta.errors.length > 0}
                    />

                    {hasQuotedContent ? (
                      <div className="px-4 pb-1">
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

                    <LazyMotion features={domAnimation} strict>
                      <AnimatePresence initial={false}>
                        {isDraggingFiles ? (
                          <m.output
                            {...getAppPresenceMotion({
                              distance: 4,
                              reducedMotion,
                            })}
                            className="mx-4 rounded-lg border border-dashed border-primary bg-primary/5 p-3 text-body-sm text-fg"
                            exit={
                              reducedMotion === true
                                ? { opacity: 0 }
                                : {
                                    opacity: 0,
                                    transform: "translate3d(0, 4px, 0)",
                                  }
                            }
                            key="attachment-drop-hint"
                            transition={{
                              duration: appMotionDuration.feedback,
                              ease: appEaseOut,
                            }}
                          >
                            {canEditBody
                              ? "Drop files to attach"
                              : "Wait for this message to finish"}
                          </m.output>
                        ) : null}
                      </AnimatePresence>
                    </LazyMotion>
                    {state.draft.attachments.length > 0 ? (
                      <ul
                        aria-label="Attachments"
                        className="flex flex-wrap gap-2 px-4 pb-2"
                      >
                        {state.draft.attachments.map((attachment) => (
                          <li
                            className="max-w-full min-w-0"
                            key={attachment.id}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button
                                    className="max-w-full min-w-0"
                                    size="compact"
                                    type="button"
                                    variant="secondary"
                                  />
                                }
                              >
                                <Icon aria-hidden icon={Attachment01Icon} />
                                <span className="truncate">
                                  {attachment.name}
                                </span>
                                <span className="shrink-0 text-muted-fg">
                                  {Math.ceil(
                                    attachment.size / 1024
                                  ).toLocaleString()}{" "}
                                  KB
                                </span>
                                <Icon aria-hidden icon={ArrowDown01Icon} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start" size="compact">
                                <DropdownMenuItem
                                  onSelect={() => {
                                    void openComposeAttachment(attachment);
                                  }}
                                >
                                  Open in new tab
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canEditBody}
                                  onSelect={() => {
                                    setRenamingAttachment(attachment);
                                  }}
                                >
                                  Rename
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  disabled={!canEditBody}
                                  onSelect={() => {
                                    removeAttachment(attachment.id);
                                  }}
                                  tone="destructive"
                                >
                                  Remove
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <ComposeEditorToolbar
                      chrome="footer"
                      leading={
                        <ToolbarButton
                          disabled={!canSubmitCompose}
                          onClick={
                            state.draft.sendUncertain === true
                              ? () => {
                                  void compose.checkSendDelivery();
                                }
                              : undefined
                          }
                          type={
                            state.draft.sendUncertain === true
                              ? "button"
                              : "submit"
                          }
                          variant="primary"
                        >
                          {state.draft.saveStatus === "sending" ? (
                            <Icon animation="spin" icon={Loading03Icon} />
                          ) : (
                            <Icon icon={MailSend02Icon} />
                          )}
                          {state.draft.sendUncertain === true
                            ? "Check delivery"
                            : "Send"}
                          <span className="hidden text-caption text-primary-fg @sm:inline">
                            {modKeyLabel}↵
                          </span>
                        </ToolbarButton>
                      }
                      trailing={
                        <>
                          <IconButtonTooltip label="Attach files">
                            <ToolbarButton
                              aria-label="Attach files"
                              disabled={!canEditBody}
                              onClick={() =>
                                attachmentInputRef.current?.click()
                              }
                              size="icon"
                              type="button"
                            >
                              <Icon icon={Attachment01Icon} />
                            </ToolbarButton>
                          </IconButtonTooltip>
                          <ComposeEditorDictationButton />
                          <form.Subscribe
                            selector={(formState) => formState.values.subject}
                          >
                            {(subject) => (
                              <ComposeFollowUp
                                value={state.draft.followUpReminder}
                                subject={subject}
                                disabled={
                                  !canEditBody || demoMode || managedDemoMode
                                }
                                onChange={compose.handleFollowUpReminderChange}
                              />
                            )}
                          </form.Subscribe>
                          <IconButtonTooltip
                            label={
                              state.draft.draftId ? "Discard draft" : "Discard"
                            }
                          >
                            <ToolbarButton
                              aria-label={
                                state.draft.draftId
                                  ? "Discard draft"
                                  : "Discard"
                              }
                              disabled={
                                !state.open ||
                                state.isFinishing ||
                                state.draft.saveStatus === "sending" ||
                                switchingSender ||
                                state.draft.sendUncertain === true
                              }
                              onClick={() => {
                                void discardActiveDraft();
                              }}
                              size="icon"
                              type="button"
                            >
                              <Icon icon={Delete02Icon} />
                            </ToolbarButton>
                          </IconButtonTooltip>
                          {isInline ? (
                            <IconButtonTooltip label="Close composer">
                              <ToolbarButton
                                aria-label="Close composer"
                                disabled={
                                  !state.open ||
                                  state.isFinishing ||
                                  state.draft.saveStatus === "sending" ||
                                  switchingSender
                                }
                                onClick={() => {
                                  void closeComposeDialog();
                                }}
                                size="icon"
                                type="button"
                              >
                                <Icon icon={Cancel01Icon} />
                              </ToolbarButton>
                            </IconButtonTooltip>
                          ) : null}
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

          {senderUnavailable ? (
            <Text as="div" role="alert" tone="destructive">
              This sending address is no longer available. You can keep editing,
              but sending is disabled.
            </Text>
          ) : null}
          {state.draft.errorMessage ? (
            <Text
              as="div"
              aria-live="polite"
              className="flex min-w-0 shrink-0 items-start"
              role="alert"
              tone="destructive"
            >
              <Icon className="mt-0.5 mr-2" icon={AlertCircleIcon} />
              <span className="min-w-0 wrap-break-word">
                {state.draft.errorMessage}
                {compose.canSaveDraftCopy ? (
                  <Button
                    disabled={state.isFinishing}
                    onClick={() => {
                      void compose.saveDraftCopy();
                    }}
                    size="sm"
                    variant="outline"
                  >
                    Save a copy and close
                  </Button>
                ) : null}
              </span>
            </Text>
          ) : null}
        </ComposerFrame>
      </form>
      {renamingAttachment ? (
        <RenameAttachmentDialog
          attachment={renamingAttachment}
          disabled={!canEditBody}
          key={renamingAttachment.id}
          onClose={() => {
            setRenamingAttachment(null);
          }}
          onSave={renameAttachment}
        />
      ) : null}
      {snippetDraft !== null && mailboxId ? (
        <SaveSnippetDialog
          initialText={snippetDraft}
          key={mailboxId}
          mailboxId={mailboxId}
          onClose={() => {
            setSnippetDraft(null);
          }}
        />
      ) : null}
    </>
  );
};

export const ComposeSurface = (props: ComposeSurfaceProps) => {
  const session = authClient.useSession().data;
  const userId = session?.user.id;
  const sessionId = session?.session.id;
  const recovery = draftRecoveryJournal.session(userId ?? "", sessionId);
  const { initialDraft, mailboxId, demoMode, managedDemoMode } = props;
  const needsRemoteLoading =
    !!mailboxId &&
    !!initialDraft &&
    demoMode !== true &&
    managedDemoMode !== true &&
    props.initialDraftNeedsSave !== true &&
    (!!initialDraft.draftId ||
      [...initialDraft.attachments, ...initialDraft.inlineImages].some(
        (asset) => !!asset.gmailAttachmentId
      ));
  const needsRecoveryLoading =
    !!mailboxId &&
    !!userId &&
    !!sessionId &&
    props.persistDrafts !== false &&
    demoMode !== true &&
    managedDemoMode !== true &&
    initialDraft?.recoveryEditorId === undefined;
  const needsLoading = needsRemoteLoading || needsRecoveryLoading;
  const seedRef = useRef(initialDraft ?? createEmptyComposeDraft());
  const [recoverableSeed, setRecoverableSeed] =
    useState<ComposeDraftState | null>(null);
  const [recoveredCopy, setRecoveredCopy] = useState<ComposeDraftState | null>(
    null
  );
  const loadedRuntimeRef = useRef<ComposeDraftState | null>(null);
  useEffect(
    () => () => {
      if (loadedRuntimeRef.current) {
        clearComposeDraftRuntimeFiles(loadedRuntimeRef.current);
      }
    },
    []
  );
  const {
    data: loadedDraft,
    error,
    isError,
    refetch,
  } = useQuery({
    enabled: needsLoading && recoveredCopy === null,
    gcTime: 0,
    queryFn: async ({ signal }) => {
      const seed = seedRef.current;
      if (!mailboxId) {
        throw new Error("Select a draft to open.");
      }
      let recoveryFailed = false;
      const findRecovery = async (candidate: ComposeDraftState) => {
        if (!userId || !sessionId || recoveryFailed) {
          return null;
        }
        try {
          if (!(await recovery.ready())) {
            return null;
          }
          return await findRecoverableComposeDraft(
            { mailboxId, userId },
            candidate,
            recovery
          );
        } catch (recoveryError) {
          recoveryFailed = true;
          toastError(recoveryError, {
            boundary: "compose-recovery",
            fallback:
              "This browser could not keep a recovery copy. Keep this draft open until it is saved.",
          });
          return null;
        }
      };
      const recovered = await findRecovery(seed);
      setRecoverableSeed(recovered);
      let draft = recovered ?? seed;
      if (!needsRemoteLoading) {
        return draft;
      }
      if (draft.sendUncertain === true) {
        return draft;
      }
      if (seed.draftId) {
        const saved = await rpc.mail.getDraft(
          { draftId: seed.draftId, mailboxId },
          { signal }
        );
        draft = {
          ...seed,
          ...saved,
          draftAnchor: saved.draftAnchor ?? null,
          errorMessage: null,
          lastSavedAt: saved.lastSavedAt,
          messageId: saved.messageId ?? undefined,
          saveStatus: "saved",
        };
        if (
          seed.draftAnchor &&
          (seed.draftAnchor.seededBy !== saved.draftAnchor?.seededBy ||
            seed.draftAnchor.sourceMessageId !==
              saved.draftAnchor?.sourceMessageId)
        ) {
          draft = {
            ...draft,
            draftAnchor: seed.draftAnchor,
            recipients: seed.recipients,
            replyContext: seed.replyContext,
            saveStatus: "idle",
            subject: seed.subject,
          };
        }
      }
      draft = (await findRecovery(draft)) ?? draft;
      if (draft.sendUncertain === true) {
        return draft;
      }
      try {
        const prepared = await prepareLoadedComposeDraft(
          mailboxId,
          draft,
          signal
        );
        loadedRuntimeRef.current = prepared;
        return prepared;
      } catch (loadError) {
        clearComposeDraftRuntimeFiles(draft);
        throw loadError;
      }
    },
    queryKey: ["compose-draft", userId, mailboxId, initialDraft?.localId],
    retry: false,
    staleTime: Infinity,
  });
  const reportLoadError = useEffectEvent(() => {
    toastError(error, {
      boundary: "compose-load",
      fallback: "Could not load your draft. Please try again.",
    });
  });
  useEffect(() => {
    if (isError) {
      reportLoadError();
    }
  }, [isError]);
  if (recoveredCopy) {
    return (
      <ReadyComposeSurface
        {...props}
        initialDraft={recoveredCopy}
        key={recoveredCopy.localId}
      />
    );
  }
  if (needsLoading && !loadedDraft) {
    const canRecoverCopy =
      recoverableSeed !== null &&
      error !== null &&
      typeof error === "object" &&
      (Reflect.get(error, "code") === "NOT_FOUND" ||
        Reflect.get(error, "status") === 404);
    return (
      <>
        {props.variant === "inline" ? null : (
          <MailSubviewHeader
            className="px-4 pt-4 sm:px-6 sm:pt-6"
            closeAction={{ label: "Close composer", onClick: props.onClose }}
            onOpenSidebar={props.onOpenSidebar}
            title="New message"
          />
        )}
        <output className="flex flex-col items-center justify-center gap-3 p-6">
          {isError ? (
            <>
              <Text>Could not load your draft.</Text>
              {canRecoverCopy ? (
                <>
                  <Text>
                    Your saved draft is no longer available. Recover your text
                    as a new draft.
                  </Text>
                  <Button
                    onClick={() => {
                      setRecoveredCopy(
                        createRecoveredComposeCopy(recoverableSeed)
                      );
                    }}
                  >
                    Recover as copy
                  </Button>
                </>
              ) : null}
              <Button
                onClick={() => {
                  void refetch();
                }}
                variant="outline"
              >
                Try again
              </Button>
              {props.variant === "inline" ? (
                <Button onClick={props.onClose} variant="ghost">
                  Close
                </Button>
              ) : null}
            </>
          ) : (
            <>
              <Icon aria-hidden animation="spin" icon={Loading03Icon} />
              <Text>Loading draft…</Text>
            </>
          )}
        </output>
      </>
    );
  }
  return (
    <ReadyComposeSurface
      {...props}
      initialDraft={needsLoading ? loadedDraft : initialDraft}
    />
  );
};

export const ComposeWorkspace = ({
  demoMode,
  initialDraft,
  initialDraftNeedsSave = false,
  mailboxId,
  managedDemoMode,
  onClose,
  onManageSnippets,
  onOpenSidebar,
  onSwitchSenderMailbox,
  persistDrafts,
  senderEmail,
  senderMailbox,
  senderMailboxes,
  signature,
}: ComposeWorkspaceProps) => {
  const queryClient = useQueryClient();
  const [senderSession, setSenderSession] = useState(() => ({
    draft: initialDraft ?? null,
    mailboxId,
    needsSave: initialDraftNeedsSave,
    senderEmail:
      senderMailboxes?.find((sender) => sender.id === mailboxId)
        ?.emailAddress ??
      senderEmail ??
      null,
  }));
  const savedSenderDrafts = useRef(new Map<string, ComposeDraftState>());
  const cleanupPromiseRef = useRef<Promise<void> | null>(null);
  const finishPromiseRef = useRef<Promise<void> | null>(null);
  const selectedSender =
    senderMailboxes?.find((sender) => sender.id === senderSession.mailboxId) ??
    (senderMailbox?.id === senderSession.mailboxId ? senderMailbox : undefined);
  const senderBoundToInitialDraft =
    !!initialDraft &&
    ((initialDraft.draftId?.trim() ?? "") !== "" ||
      (initialDraft.messageId?.trim() ?? "") !== "" ||
      !!initialDraft.replyContext ||
      !!initialDraft.draftAnchor ||
      initialDraft.recoveryEditorId !== undefined);
  const cleanupInactiveDrafts = async (): Promise<void> => {
    if (cleanupPromiseRef.current !== null) {
      await cleanupPromiseRef.current;
      return;
    }
    const inactiveDrafts = [...savedSenderDrafts.current].filter(
      ([sourceMailboxId, draft]) =>
        sourceMailboxId !== senderSession.mailboxId &&
        sourceMailboxId !== "" &&
        (draft.draftId?.trim() ?? "") !== ""
    );
    cleanupPromiseRef.current = (async () => {
      for (const [sourceMailboxId, draft] of inactiveDrafts) {
        try {
          if (demoMode === true) {
            deleteDemoDraft(draft);
          } else if (managedDemoMode === true) {
            deleteManagedDemoDraft(draft);
          } else {
            await deleteComposeDraft(sourceMailboxId, draft);
          }
        } catch (error) {
          toastError(error, {
            boundary: "compose-inactive-draft-cleanup",
            fallback:
              "An older draft could not be removed. You can delete it from Drafts.",
          });
          continue;
        }
        try {
          await refreshCachedMailboxQueries(
            queryClient,
            sourceMailboxId,
            "drafts"
          );
        } catch (error) {
          toastError(error, {
            boundary: "compose-inactive-draft-refresh",
            fallback:
              "An older draft was removed. Refresh Drafts to update the list.",
          });
        }
      }
    })();
    await cleanupPromiseRef.current;
  };
  const finishCompose = (afterClose: () => void) => {
    if (finishPromiseRef.current !== null) {
      return;
    }
    finishPromiseRef.current = (async () => {
      await cleanupInactiveDrafts();
      afterClose();
    })();
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        entranceMotionVariants({ effect: "slide" })
      )}
      data-compose-workspace
    >
      <ComposeSurface
        allowSenderSwitch={!senderBoundToInitialDraft}
        beforeNavigate={cleanupInactiveDrafts}
        className="flex-1"
        demoMode={demoMode}
        initialDraft={senderSession.draft}
        initialDraftNeedsSave={senderSession.needsSave}
        key={senderSession.mailboxId ?? "none"}
        mailboxId={senderSession.mailboxId}
        managedDemoMode={managedDemoMode}
        onClose={() => {
          finishCompose(onClose);
        }}
        onOpenSidebar={onOpenSidebar}
        onManageSnippets={
          onManageSnippets
            ? () => {
                finishCompose(onManageSnippets);
              }
            : undefined
        }
        onSenderSwitch={async (
          nextMailboxId,
          currentDraft,
          transferDraft,
          hasAuthoredContent
        ) => {
          if (senderSession.mailboxId && selectedSender !== undefined) {
            savedSenderDrafts.current.set(
              senderSession.mailboxId,
              currentDraft
            );
          }
          await onSwitchSenderMailbox?.(nextMailboxId);
          const savedDraft = savedSenderDrafts.current.get(nextMailboxId);
          setSenderSession({
            draft: savedDraft
              ? {
                  ...savedDraft,
                  attachments: transferDraft.attachments,
                  bodyHtml: transferDraft.bodyHtml,
                  bodyText: transferDraft.bodyText,
                  errorMessage: null,
                  followUpReminder: transferDraft.followUpReminder,
                  inlineImages: transferDraft.inlineImages,
                  recipients: transferDraft.recipients,
                  saveStatus: "idle",
                  subject: transferDraft.subject,
                  updatedAt: Date.now(),
                }
              : transferDraft,
            mailboxId: nextMailboxId,
            needsSave:
              (savedDraft?.draftId?.trim() ?? "") !== "" || hasAuthoredContent,
            senderEmail:
              senderMailboxes?.find((sender) => sender.id === nextMailboxId)
                ?.emailAddress ?? null,
          });
        }}
        persistDrafts={persistDrafts}
        senderEmail={selectedSender?.emailAddress ?? senderSession.senderEmail}
        senderMailbox={selectedSender}
        senderMailboxes={senderMailboxes}
        senderUnavailable={
          senderMailboxes !== undefined && selectedSender === undefined
        }
        signature={
          selectedSender
            ? {
                html: selectedSender.signatureHtml ?? null,
                text: selectedSender.signatureText ?? null,
              }
            : signature
        }
      />
    </div>
  );
};
