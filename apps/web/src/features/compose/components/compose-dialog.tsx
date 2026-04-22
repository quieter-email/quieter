"use client";

import { AlertCircleIcon, Loading03Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { composeDraftFormValuesSchema, composeSendFormValuesSchema } from "@quieter/orpc/compose";
import { Button, Dialog, DialogContent, cn } from "@quieter/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { z } from "zod";
import { getErrorMessage, getFieldErrorMessage } from "~/lib/errors";
import { refreshCachedMailboxQueries } from "~/lib/gmail/inbox-query";
import { getThreadQueryKey } from "~/lib/gmail/thread-query";
import {
  attachInlineImagesToHtml,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  deleteComposeDraft,
  haveComposeDraftPersistedFieldsChanged,
  hasComposeDraftContent,
  removeComposeRuntimeFile,
  saveComposeDraft,
  sendComposeDraft,
  syncInlineImagesWithHtml,
  type ComposeDraftState,
} from "../domain/draft";
import { ComposeEditor } from "./compose-editor";

export type ComposeDialogHandle = {
  openDraft: (draft: ComposeDraftState | null) => void;
  openNewMail: () => void;
};

type ComposeDialogProps = {
  mailboxId: string | null;
};

type ComposeFormValues = z.infer<typeof composeDraftFormValuesSchema>;

const emptyFormValues: ComposeFormValues = {
  to: "",
  cc: "",
  bcc: "",
  subject: "",
  bodyHtml: "",
  bodyText: "",
};

const draftToFormValues = (draft: ComposeDraftState): ComposeFormValues => ({
  to: draft.recipients.to,
  cc: draft.recipients.cc,
  bcc: draft.recipients.bcc,
  subject: draft.subject,
  bodyHtml: draft.bodyHtml,
  bodyText: draft.bodyText,
});

const formValuesToDraft = (
  values: ComposeFormValues,
  meta: Pick<
    ComposeDraftState,
    | "localId"
    | "draftId"
    | "messageId"
    | "draftAnchor"
    | "replyContext"
    | "attachments"
    | "inlineImages"
    | "saveStatus"
    | "errorMessage"
    | "lastSavedAt"
    | "updatedAt"
  >,
): ComposeDraftState => {
  const base = {
    ...meta,
    recipients: { to: values.to, cc: values.cc, bcc: values.bcc },
    subject: values.subject,
    bodyHtml: values.bodyHtml,
    bodyText: values.bodyText,
  };
  const beforeIds = new Set(meta.inlineImages.map((image) => image.id));
  const synced = syncInlineImagesWithHtml(base, values.bodyHtml);
  const afterIds = new Set(synced.inlineImages.map((image) => image.id));

  for (const id of beforeIds) {
    if (!afterIds.has(id)) {
      removeComposeRuntimeFile(id);
    }
  }

  return synced;
};

const canSaveComposeFormValues = (values: ComposeFormValues) =>
  composeDraftFormValuesSchema.safeParse(values).success;

const createComposeDialogState = () => ({
  activeDraft: createEmptyComposeDraft(),
  dialogOpen: false,
  showBcc: false,
  showCc: false,
});

const COMPOSE_DEBUG_STORAGE_KEY = "quieter:compose-debug";

const logComposeDebug = (event: string, payload?: Record<string, unknown> | undefined) => {
  if (
    typeof window === "undefined" ||
    window.localStorage.getItem(COMPOSE_DEBUG_STORAGE_KEY) !== "1"
  ) {
    return;
  }

  console.debug("[compose]", event, payload ?? {});
};

export const ComposeDialog = forwardRef<ComposeDialogHandle, ComposeDialogProps>(
  function ComposeDialog({ mailboxId }, ref) {
    const queryClient = useQueryClient();
    const prefersReducedMotion = useReducedMotion();
    const [dialogState, setDialogState] = useState(createComposeDialogState);
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const savePromiseRef = useRef<Promise<void> | null>(null);
    const saveQueuedRef = useRef(false);
    const activeDraftRef = useRef(dialogState.activeDraft);

    const form = useForm({
      defaultValues: emptyFormValues,
      onSubmit: async ({ value }) => {
        await submitComposeForm(value);
      },
      validationLogic: revalidateLogic(),
      validators: {
        onDynamic: composeDraftFormValuesSchema,
        onSubmit: composeSendFormValuesSchema,
      },
    });
    const { activeDraft, dialogOpen, showBcc, showCc } = dialogState;
    const composeError = activeDraft.errorMessage;
    const isBlockingAction =
      activeDraft.saveStatus === "sending" || activeDraft.saveStatus === "discarding";

    const setActiveDraft = (
      nextDraft: ComposeDraftState | ((currentDraft: ComposeDraftState) => ComposeDraftState),
    ) => {
      setDialogState((currentState) => ({
        ...currentState,
        activeDraft:
          typeof nextDraft === "function" ? nextDraft(currentState.activeDraft) : nextDraft,
      }));
    };

    const resetComposeDialogState = () => {
      setDialogState(createComposeDialogState());
      form.reset(emptyFormValues);
    };

    const setComposeDialogOpen = (value: boolean) => {
      setDialogState((currentState) => ({
        ...currentState,
        dialogOpen: value,
      }));
    };

    const toggleComposeRecipientVisibility = (field: "cc" | "bcc") => {
      setDialogState((currentState) => ({
        ...currentState,
        showBcc: field === "bcc" ? !currentState.showBcc : currentState.showBcc,
        showCc: field === "cc" ? !currentState.showCc : currentState.showCc,
      }));
    };

    const getCurrentFormValues = () => form.state.values;

    const clearActiveDraftError = () => {
      const current = activeDraftRef.current;

      if (!current.errorMessage && current.saveStatus !== "error") {
        return;
      }

      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        errorMessage: null,
        saveStatus: currentDraft.saveStatus === "error" ? "idle" : currentDraft.saveStatus,
      }));
    };

    const setActiveDraftErrorMessage = (message: string) => {
      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        errorMessage: message,
        saveStatus: "error",
      }));
    };

    const resetComposeForm = (nextValues: ComposeFormValues) => {
      form.reset(nextValues);
      form.setFieldValue("to", nextValues.to);
      form.setFieldValue("cc", nextValues.cc);
      form.setFieldValue("bcc", nextValues.bcc);
      form.setFieldValue("subject", nextValues.subject);
      form.setFieldValue("bodyHtml", nextValues.bodyHtml);
      form.setFieldValue("bodyText", nextValues.bodyText);
      void form.validateAllFields("change");
    };

    const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
      const meta = activeDraft;

      return formValuesToDraft(values, {
        localId: meta.localId,
        draftId: meta.draftId,
        messageId: meta.messageId,
        draftAnchor: meta.draftAnchor,
        replyContext: meta.replyContext,
        attachments: meta.attachments,
        inlineImages: meta.inlineImages,
        saveStatus: "idle",
        errorMessage: null,
        lastSavedAt: meta.lastSavedAt,
        updatedAt: Date.now(),
      });
    };

    const replaceDraftByLocalId = (localId: string, replacement: ComposeDraftState | null) => {
      setDialogState((currentState) => {
        if (currentState.activeDraft.localId !== localId) {
          return currentState;
        }

        return {
          ...currentState,
          activeDraft: replacement ? cloneComposeDraft(replacement) : createEmptyComposeDraft(),
        };
      });
    };

    const shouldPersistDraft = (draft: ComposeDraftState, values: ComposeFormValues) =>
      canSaveComposeFormValues(values) &&
      hasComposeDraftContent(draft) &&
      (activeDraftRef.current.saveStatus === "error" ||
        !draft.draftId ||
        haveComposeDraftPersistedFieldsChanged(activeDraftRef.current, draft));

    const openComposeDraft = (nextDraft: ComposeDraftState | null) => {
      const draft = nextDraft ? cloneComposeDraft(nextDraft) : createEmptyComposeDraft();

      clearTimeout(autosaveTimerRef.current);
      activeDraftRef.current = draft;
      logComposeDebug("open", {
        draftId: draft.draftId ?? null,
        hasContent: hasComposeDraftContent(draft),
        localId: draft.localId,
        saveStatus: draft.saveStatus,
      });
      resetComposeForm(draftToFormValues(draft));
      setDialogState({
        activeDraft: draft,
        dialogOpen: true,
        showBcc: Boolean(draft.recipients.bcc.trim()),
        showCc: Boolean(draft.recipients.cc.trim()),
      });
    };

    const closeAndResetComposeDialog = () => {
      clearTimeout(autosaveTimerRef.current);
      clearComposeDraftRuntimeFiles(activeDraft);
      resetComposeDialogState();
    };

    const refreshComposeThread = async (draft: ComposeDraftState) => {
      if (!mailboxId) {
        return;
      }

      const threadId = draft.replyContext?.threadId ?? draft.draftAnchor?.sourceThreadId;
      if (!threadId) {
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: getThreadQueryKey(mailboxId, threadId),
      });
      await queryClient.refetchQueries({
        queryKey: getThreadQueryKey(mailboxId, threadId),
        type: "active",
      });
    };

    const flushActiveSave = async (
      explicitDraft?: ComposeDraftState,
      explicitValues?: ComposeFormValues,
    ): Promise<ComposeDraftState> => {
      if (savePromiseRef.current) {
        logComposeDebug("save:queue", {
          activeDraftId: activeDraftRef.current.draftId ?? null,
          localId: activeDraftRef.current.localId,
        });
        saveQueuedRef.current = true;
        await savePromiseRef.current;
        return activeDraftRef.current;
      }

      if (!mailboxId) {
        throw new Error("Sign in before composing.");
      }

      const formValues = explicitValues ?? getCurrentFormValues();
      const draftSnapshot = explicitDraft ?? buildDraftFromForm(formValues);
      if (!shouldPersistDraft(draftSnapshot, formValues)) {
        logComposeDebug("save:skip", {
          draftId: draftSnapshot.draftId ?? null,
          hasContent: hasComposeDraftContent(draftSnapshot),
          localId: draftSnapshot.localId,
          saveStatus: activeDraftRef.current.saveStatus,
        });
        return draftSnapshot;
      }

      logComposeDebug("save:start", {
        draftId: draftSnapshot.draftId ?? null,
        isDirty: form.state.isDirty,
        localId: draftSnapshot.localId,
      });
      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        saveStatus: "saving",
        errorMessage: null,
      }));

      savePromiseRef.current = (async () => {
        try {
          const savedDraft = await saveComposeDraft(mailboxId, draftSnapshot);
          logComposeDebug("save:success", {
            draftId: savedDraft.draftId ?? null,
            localId: savedDraft.localId,
            lastSavedAt: savedDraft.lastSavedAt ?? null,
          });
          replaceDraftByLocalId(draftSnapshot.localId, savedDraft);
        } catch (error) {
          logComposeDebug("save:error", {
            draftId: draftSnapshot.draftId ?? null,
            error: getErrorMessage(error, "Could not save draft."),
            localId: draftSnapshot.localId,
          });
          replaceDraftByLocalId(draftSnapshot.localId, {
            ...draftSnapshot,
            saveStatus: "error",
            errorMessage: getErrorMessage(error, "Could not save draft."),
          });
        } finally {
          savePromiseRef.current = null;

          if (saveQueuedRef.current) {
            saveQueuedRef.current = false;
            await flushActiveSave();
          }
        }
      })();

      await savePromiseRef.current;
      const nextActiveDraft = activeDraftRef.current;
      if (nextActiveDraft.saveStatus === "error") {
        throw new Error(nextActiveDraft.errorMessage ?? "Could not save draft.");
      }

      return nextActiveDraft.localId === draftSnapshot.localId ? nextActiveDraft : draftSnapshot;
    };

    const scheduleAutosave = () => {
      clearTimeout(autosaveTimerRef.current);

      if (isBlockingAction || !mailboxId || !dialogOpen) {
        return;
      }

      const formValues = getCurrentFormValues();
      const draft = buildDraftFromForm(formValues);
      if (!shouldPersistDraft(draft, formValues)) {
        return;
      }

      logComposeDebug("save:schedule", {
        draftId: draft.draftId ?? null,
        localId: draft.localId,
        saveStatus: activeDraftRef.current.saveStatus,
      });
      autosaveTimerRef.current = setTimeout(() => {
        void flushActiveSave().catch(() => {});
      }, 500);
    };

    const submitComposeForm = async (values: ComposeFormValues) => {
      if (!mailboxId) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(values);
      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        saveStatus: "sending",
        errorMessage: null,
      }));

      try {
        const savedDraft = await flushActiveSave(draft, values);
        await sendComposeDraft(mailboxId, savedDraft);
        clearComposeDraftRuntimeFiles(savedDraft);

        resetComposeDialogState();
        await Promise.all([
          refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
          refreshCachedMailboxQueries(queryClient, mailboxId, "sent"),
          refreshComposeThread(savedDraft),
        ]);
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not send message."));
      }
    };

    const discardActiveDraft = async () => {
      if (
        !mailboxId ||
        activeDraft.saveStatus === "sending" ||
        activeDraft.saveStatus === "saving"
      ) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(getCurrentFormValues());
      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        saveStatus: "discarding",
        errorMessage: null,
      }));

      try {
        await deleteComposeDraft(mailboxId, draft);
        clearComposeDraftRuntimeFiles(draft);
        resetComposeDialogState();
        await Promise.all([
          refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
          refreshComposeThread(draft),
        ]);
      } catch (error) {
        setActiveDraftErrorMessage(
          getErrorMessage(
            error,
            draft.draftId ? "Could not delete draft." : "Could not discard draft.",
          ),
        );
      }
    };

    const closeComposeDialog = async () => {
      if (activeDraft.saveStatus === "sending") {
        return;
      }

      clearTimeout(autosaveTimerRef.current);

      if (!mailboxId) {
        resetComposeDialogState();
        return;
      }

      const formValues = getCurrentFormValues();
      const draft = buildDraftFromForm(formValues);
      const shouldSave = shouldPersistDraft(draft, formValues);

      if (!shouldSave) {
        closeAndResetComposeDialog();
        return;
      }

      setActiveDraft((currentDraft) => ({
        ...currentDraft,
        saveStatus: "saving",
        errorMessage: null,
      }));

      try {
        const savedDraft = await flushActiveSave(draft, formValues);
        await Promise.all([
          refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
          refreshComposeThread(savedDraft),
        ]);
        closeAndResetComposeDialog();
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not save draft."));
      }
    };

    const handleDialogOpenChange = (open: boolean) => {
      if (open) {
        setComposeDialogOpen(true);
        return;
      }

      void closeComposeDialog();
    };

    const addInlineImageFiles = async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      try {
        clearActiveDraftError();
        const inlineImages = await createComposeInlineImagesFromFiles(files);
        const nextDraft: ComposeDraftState = {
          ...activeDraft,
          inlineImages: [...activeDraft.inlineImages, ...inlineImages],
          saveStatus: "idle",
          errorMessage: null,
          updatedAt: Date.now(),
        };
        setActiveDraft(nextDraft);

        const nextHtml = attachInlineImagesToHtml(nextDraft, inlineImages);
        form.setFieldValue("bodyHtml", nextHtml);
        scheduleAutosave();
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not add those images."));
      }
    };

    useImperativeHandle(ref, () => ({
      openDraft: (draft) => {
        openComposeDraft(draft ? cloneComposeDraft(draft) : null);
      },
      openNewMail: () => {
        openComposeDraft(null);
      },
    }));

    useEffect(() => {
      activeDraftRef.current = activeDraft;
    }, [activeDraft]);

    useEffect(() => {
      return () => {
        clearTimeout(autosaveTimerRef.current);
      };
    }, []);

    const draftStatusMessage =
      activeDraft.saveStatus === "sending"
        ? "Sending message..."
        : activeDraft.saveStatus === "saving"
          ? "Saving draft..."
          : activeDraft.saveStatus === "error"
            ? "Draft needs attention"
            : activeDraft.lastSavedAt
              ? "Draft saved"
              : "Drafts save automatically";
    const canDiscardDraft = activeDraft.draftId || hasComposeDraftContent(activeDraft);
    const discardButtonLabel = activeDraft.draftId ? "Discard draft" : "Discard";

    return (
      <Dialog onOpenChange={handleDialogOpenChange} open={dialogOpen}>
        <DialogContent className="max-h-[85vh] w-[min(92vw,46rem)] overflow-hidden bg-background-light p-0 transition-opacity duration-100 data-ending-style:scale-100 data-starting-style:scale-100">
          <form
            action={async () => {
              await form.handleSubmit();
            }}
            className="max-h-[85vh] overflow-y-auto px-5 py-5 sm:px-6 sm:py-6"
          >
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4 pb-1">
                <div className="space-y-1">
                  <p className="text-sm font-semibold tracking-tight text-foreground">
                    New message
                  </p>
                  <p className="text-xs text-muted-foreground">{draftStatusMessage}</p>
                </div>
              </div>

              <div className="space-y-3">
                <form.Field name="to">
                  {(field) => {
                    const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                    return (
                      <div className="space-y-2">
                        <div
                          className={cn(
                            "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
                            {
                              "bg-destructive/10": Boolean(fieldError),
                            },
                          )}
                        >
                          <input
                            aria-invalid={fieldError ? true : undefined}
                            aria-label="Recipients"
                            autoComplete="off"
                            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                            onBlur={() => field.handleBlur()}
                            onChange={(event) => {
                              clearActiveDraftError();
                              field.handleChange(event.currentTarget.value);
                              scheduleAutosave();
                            }}
                            placeholder="To"
                            spellCheck={false}
                            type="text"
                            value={field.state.value}
                          />
                          <div className="flex shrink-0 items-center gap-3">
                            <button
                              aria-controls="compose-cc-field"
                              aria-expanded={showCc}
                              className={cn("text-xs transition-colors", {
                                "text-foreground": showCc,
                                "text-muted-foreground hover:text-foreground": !showCc,
                              })}
                              onClick={() => toggleComposeRecipientVisibility("cc")}
                              type="button"
                            >
                              Cc
                            </button>
                            <button
                              aria-controls="compose-bcc-field"
                              aria-expanded={showBcc}
                              className={cn("text-xs transition-colors", {
                                "text-foreground": showBcc,
                                "text-muted-foreground hover:text-foreground": !showBcc,
                              })}
                              onClick={() => toggleComposeRecipientVisibility("bcc")}
                              type="button"
                            >
                              Bcc
                            </button>
                          </div>
                        </div>

                        {fieldError ? (
                          <p className="pl-1 text-xs text-destructive">{fieldError}</p>
                        ) : null}
                      </div>
                    );
                  }}
                </form.Field>

                <LazyMotion features={domAnimation}>
                  <AnimatePresence initial={false}>
                    {showCc ? (
                      <m.div
                        animate={{ height: "auto", marginTop: 12, opacity: 1, y: 0 }}
                        className="overflow-hidden"
                        exit={{
                          height: 0,
                          marginTop: 0,
                          opacity: 0,
                          y: prefersReducedMotion ? 0 : -4,
                        }}
                        id="compose-cc-field"
                        initial={{
                          height: 0,
                          marginTop: 0,
                          opacity: 0,
                          y: prefersReducedMotion ? 0 : -4,
                        }}
                        transition={
                          prefersReducedMotion
                            ? { duration: 0 }
                            : { duration: 0.09, ease: "easeOut" as const }
                        }
                      >
                        <form.Field name="cc">
                          {(field) => {
                            const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                            return (
                              <div className="space-y-2">
                                <div
                                  className={cn(
                                    "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
                                    {
                                      "bg-destructive/10": Boolean(fieldError),
                                    },
                                  )}
                                >
                                  <input
                                    aria-invalid={fieldError ? true : undefined}
                                    aria-label="Cc recipients"
                                    autoComplete="off"
                                    className="min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                                    onBlur={() => field.handleBlur()}
                                    onChange={(event) => {
                                      clearActiveDraftError();
                                      field.handleChange(event.currentTarget.value);
                                      scheduleAutosave();
                                    }}
                                    placeholder="Cc"
                                    spellCheck={false}
                                    type="text"
                                    value={field.state.value}
                                  />
                                </div>

                                {fieldError ? (
                                  <p className="pl-1 text-xs text-destructive">{fieldError}</p>
                                ) : null}
                              </div>
                            );
                          }}
                        </form.Field>
                      </m.div>
                    ) : null}
                  </AnimatePresence>

                  <AnimatePresence initial={false}>
                    {showBcc ? (
                      <m.div
                        animate={{ height: "auto", marginTop: 12, opacity: 1, y: 0 }}
                        className="overflow-hidden"
                        exit={{
                          height: 0,
                          marginTop: 0,
                          opacity: 0,
                          y: prefersReducedMotion ? 0 : -4,
                        }}
                        id="compose-bcc-field"
                        initial={{
                          height: 0,
                          marginTop: 0,
                          opacity: 0,
                          y: prefersReducedMotion ? 0 : -4,
                        }}
                        transition={
                          prefersReducedMotion
                            ? { duration: 0 }
                            : { duration: 0.09, ease: "easeOut" as const }
                        }
                      >
                        <form.Field name="bcc">
                          {(field) => {
                            const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                            return (
                              <div className="space-y-2">
                                <div
                                  className={cn(
                                    "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
                                    {
                                      "bg-destructive/10": Boolean(fieldError),
                                    },
                                  )}
                                >
                                  <input
                                    aria-invalid={fieldError ? true : undefined}
                                    aria-label="Bcc recipients"
                                    autoComplete="off"
                                    className="min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                                    onBlur={() => field.handleBlur()}
                                    onChange={(event) => {
                                      clearActiveDraftError();
                                      field.handleChange(event.currentTarget.value);
                                      scheduleAutosave();
                                    }}
                                    placeholder="Bcc"
                                    spellCheck={false}
                                    type="text"
                                    value={field.state.value}
                                  />
                                </div>

                                {fieldError ? (
                                  <p className="pl-1 text-xs text-destructive">{fieldError}</p>
                                ) : null}
                              </div>
                            );
                          }}
                        </form.Field>
                      </m.div>
                    ) : null}
                  </AnimatePresence>
                </LazyMotion>

                <form.Field name="subject">
                  {(field) => (
                    <div
                      className={cn(
                        "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
                        "mt-3",
                      )}
                    >
                      <input
                        aria-label="Subject"
                        autoComplete="off"
                        className="min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60"
                        onBlur={() => field.handleBlur()}
                        onChange={(event) => {
                          clearActiveDraftError();
                          field.handleChange(event.currentTarget.value);
                          scheduleAutosave();
                        }}
                        placeholder="Subject"
                        type="text"
                        value={field.state.value}
                      />
                    </div>
                  )}
                </form.Field>
              </div>

              <form.Field name="bodyHtml">
                {(field) => (
                  <ComposeEditor
                    disabled={isBlockingAction || !mailboxId}
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

              <div className="flex min-h-10 items-center justify-end gap-3 pt-1">
                {composeError ? (
                  <div
                    aria-live="polite"
                    className="mr-auto flex min-w-0 items-center gap-2 text-sm text-destructive"
                  >
                    <HugeiconsIcon className="size-4 shrink-0" icon={AlertCircleIcon} />
                    <span className="truncate">{composeError}</span>
                  </div>
                ) : null}

                {canDiscardDraft ? (
                  <Button
                    className={cn({ "mr-auto": !composeError })}
                    disabled={
                      activeDraft.saveStatus === "discarding" ||
                      activeDraft.saveStatus === "saving" ||
                      activeDraft.saveStatus === "sending"
                    }
                    onClick={() => {
                      void discardActiveDraft();
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    {discardButtonLabel}
                  </Button>
                ) : null}

                <Button
                  disabled={isBlockingAction || !mailboxId}
                  size="sm"
                  type="submit"
                  variant={activeDraft.saveStatus === "sending" ? "outline" : "default"}
                >
                  {activeDraft.saveStatus === "sending" ? (
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
