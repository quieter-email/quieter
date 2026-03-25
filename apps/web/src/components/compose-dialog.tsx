"use client";

import { AlertCircleIcon, Loading03Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { composeDraftFormValuesSchema, composeSendFormValuesSchema } from "@quietr/orpc/compose";
import { Button, Dialog, DialogContent, cn } from "@quietr/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { z } from "zod";
import { getErrorMessage, getFieldErrorMessage } from "~/lib/errors";
import {
  attachInlineImagesToHtml,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  cloneComposeSessionState,
  createComposeInlineImagesFromFiles,
  deleteComposeDraft,
  createEmptyComposeDraft,
  createInitialComposeSessionState,
  hasComposeDraftContent,
  hydrateComposeDraftRuntime,
  removeComposeRuntimeFile,
  saveComposeDraft,
  sendComposeDraft,
  syncInlineImagesWithHtml,
  type ComposeDraftState,
  type ComposeSessionState,
} from "~/lib/gmail/compose";
import { loadComposeSession, persistComposeSession } from "~/lib/gmail/compose-query";
import { refreshCachedMailboxQueries } from "~/lib/gmail/inbox-query";
import { ComposeEditor } from "./compose-editor";

export type ComposeDialogHandle = {
  openDraft: (draft: ComposeDraftState | null) => void;
  openNewMail: () => void;
};

type ComposeDialogProps = {
  mailboxId: string | null;
};

type ComposeFormValues = z.infer<typeof composeDraftFormValuesSchema>;

const fieldContainerClass =
  "flex min-h-10 items-center gap-3 rounded-md border border-input bg-background px-3.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20";
const fieldInputClass =
  "min-w-0 flex-1 bg-transparent py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground/60";
const recipientFieldTransition = {
  duration: 0.09,
  ease: "easeOut" as const,
};

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

export const ComposeDialog = forwardRef<ComposeDialogHandle, ComposeDialogProps>(
  function ComposeDialog({ mailboxId }, ref) {
    const queryClient = useQueryClient();
    const prefersReducedMotion = useReducedMotion();
    const [dialogOpen, setDialogOpen] = useState(false);
    const [showCc, setShowCc] = useState(false);
    const [showBcc, setShowBcc] = useState(false);
    const [transitionBusy, setTransitionBusy] = useState(false);
    const [composeSession, setComposeSessionState] = useState<ComposeSessionState>(() =>
      createInitialComposeSessionState(),
    );

    const composeSessionRef = useRef(composeSession);
    const loadedMailboxIdRef = useRef("");
    const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const savePromiseRef = useRef<Promise<void> | null>(null);
    const saveQueuedRef = useRef(false);

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

    const activeDraft = composeSession.activeDraft;
    const lastDraft = composeSession.lastDraft;
    const composeError = activeDraft.errorMessage;
    const isBusy =
      transitionBusy ||
      activeDraft.saveStatus === "sending" ||
      activeDraft.saveStatus === "discarding";

    const setComposeSession = (next: ComposeSessionState) => {
      composeSessionRef.current = next;
      setComposeSessionState(next);
    };

    const getCurrentFormValues = () => form.state.values;

    const clearActiveDraftError = () => {
      const current = composeSessionRef.current.activeDraft;

      if (!current.errorMessage && current.saveStatus !== "error") {
        return;
      }

      const nextSession = cloneComposeSessionState(composeSessionRef.current);
      nextSession.activeDraft = {
        ...nextSession.activeDraft,
        errorMessage: null,
        saveStatus:
          nextSession.activeDraft.saveStatus === "error"
            ? "idle"
            : nextSession.activeDraft.saveStatus,
      };
      setComposeSession(nextSession);
    };

    const setActiveDraftErrorMessage = (message: string) => {
      const nextSession = cloneComposeSessionState(composeSessionRef.current);
      nextSession.activeDraft = {
        ...nextSession.activeDraft,
        errorMessage: message,
        saveStatus: "error",
      };
      setComposeSession(nextSession);
    };

    const resetComposeForm = (nextValues: ComposeFormValues) => {
      form.reset(nextValues);
      void form.validateAllFields("change");
    };

    const syncComposeDraftIntoForm = (draft: ComposeDraftState) => {
      resetComposeForm(draftToFormValues(draft));
      setShowCc(Boolean(draft.recipients.cc.trim()));
      setShowBcc(Boolean(draft.recipients.bcc.trim()));
    };

    const persistSession = async (session = composeSessionRef.current) => {
      if (!mailboxId) {
        return;
      }

      await persistComposeSession(queryClient, mailboxId, session);
    };

    const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
      const meta = composeSessionRef.current.activeDraft;

      return formValuesToDraft(values, {
        localId: meta.localId,
        draftId: meta.draftId,
        messageId: meta.messageId,
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
      const current = composeSessionRef.current;

      if (current.activeDraft.localId === localId) {
        const next = cloneComposeSessionState(current);
        next.activeDraft = replacement ? cloneComposeDraft(replacement) : createEmptyComposeDraft();
        setComposeSession(next);
        return;
      }

      if (current.lastDraft?.localId === localId) {
        const next = cloneComposeSessionState(current);
        next.lastDraft = replacement ? cloneComposeDraft(replacement) : null;
        setComposeSession(next);
      }
    };

    const flushActiveSave = async (): Promise<ComposeDraftState> => {
      if (savePromiseRef.current) {
        saveQueuedRef.current = true;
        await savePromiseRef.current;
        return composeSessionRef.current.activeDraft;
      }

      if (!mailboxId) {
        throw new Error("Sign in before composing.");
      }

      const formValues = getCurrentFormValues();
      const draftSnapshot = buildDraftFromForm(formValues);
      if (!hasComposeDraftContent(draftSnapshot) || !canSaveComposeFormValues(formValues)) {
        return draftSnapshot;
      }

      const next = cloneComposeSessionState(composeSessionRef.current);
      next.activeDraft = { ...draftSnapshot, saveStatus: "saving", errorMessage: null };
      setComposeSession(next);

      savePromiseRef.current = (async () => {
        try {
          const savedDraft = await saveComposeDraft(mailboxId, draftSnapshot);
          replaceDraftByLocalId(draftSnapshot.localId, savedDraft);
        } catch (error) {
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
      const savedDraft = composeSessionRef.current.activeDraft;
      if (savedDraft.saveStatus === "error") {
        throw new Error(savedDraft.errorMessage ?? "Could not save draft.");
      }

      return savedDraft;
    };

    const scheduleAutosave = () => {
      clearTimeout(autosaveTimerRef.current);

      if (isBusy || !mailboxId) {
        return;
      }

      const formValues = getCurrentFormValues();
      if (!canSaveComposeFormValues(formValues)) {
        return;
      }

      const draft = buildDraftFromForm(formValues);
      if (!hasComposeDraftContent(draft)) {
        return;
      }

      autosaveTimerRef.current = setTimeout(() => {
        void flushActiveSave().catch(() => {});
      }, 500);
    };

    const openComposeDraft = (nextDraft: ComposeDraftState | null) => {
      if (!mailboxId) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);

      const currentValues = getCurrentFormValues();
      const currentDraft = buildDraftFromForm(currentValues);
      const currentSession = composeSessionRef.current;
      const nextActiveDraft = nextDraft ? cloneComposeDraft(nextDraft) : createEmptyComposeDraft();
      const nextLastDraft = hasComposeDraftContent(currentDraft)
        ? cloneComposeDraft(currentDraft)
        : currentSession.lastDraft
          ? cloneComposeDraft(currentSession.lastDraft)
          : null;
      const nextSession = {
        activeDraft: nextActiveDraft,
        lastDraft: nextLastDraft,
      };

      setComposeSession(nextSession);
      syncComposeDraftIntoForm(nextActiveDraft);
      setDialogOpen(true);

      if (hasComposeDraftContent(currentDraft) && canSaveComposeFormValues(currentValues)) {
        const localId = currentDraft.localId;
        const savingSession = cloneComposeSessionState(nextSession);
        if (savingSession.lastDraft?.localId === localId) {
          savingSession.lastDraft = {
            ...savingSession.lastDraft,
            saveStatus: "saving",
            errorMessage: null,
          };
        }
        setComposeSession(savingSession);

        void saveComposeDraft(mailboxId, currentDraft)
          .then((savedDraft) => replaceDraftByLocalId(localId, savedDraft))
          .catch((error) => {
            replaceDraftByLocalId(localId, {
              ...currentDraft,
              saveStatus: "error",
              errorMessage: getErrorMessage(error, "Could not save draft."),
            });
          });
      }
    };

    const continueLastDraft = async () => {
      if (!mailboxId || !lastDraft) {
        return;
      }

      setTransitionBusy(true);

      try {
        clearTimeout(autosaveTimerRef.current);

        const currentValues = getCurrentFormValues();
        const currentDraft = buildDraftFromForm(currentValues);
        if (hasComposeDraftContent(currentDraft) && canSaveComposeFormValues(currentValues)) {
          const localId = currentDraft.localId;
          void saveComposeDraft(mailboxId, currentDraft)
            .then((savedDraft) => replaceDraftByLocalId(localId, savedDraft))
            .catch((error) => {
              replaceDraftByLocalId(localId, {
                ...currentDraft,
                saveStatus: "error",
                errorMessage: getErrorMessage(error, "Could not save draft."),
              });
            });
        }

        const hydratedDraft = await hydrateComposeDraftRuntime(
          mailboxId,
          cloneComposeDraft(lastDraft),
        );
        const nextSession = cloneComposeSessionState(composeSessionRef.current);
        nextSession.activeDraft = hydratedDraft;
        nextSession.lastDraft = hasComposeDraftContent(currentDraft)
          ? cloneComposeDraft(currentDraft)
          : null;
        setComposeSession(nextSession);
        syncComposeDraftIntoForm(hydratedDraft);
        setDialogOpen(true);
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not reopen the last draft."));
      } finally {
        setTransitionBusy(false);
      }
    };

    const openRequestedDraft = async (nextDraft: ComposeDraftState | null) => {
      if (!mailboxId) {
        return;
      }

      if (!nextDraft?.draftId) {
        openComposeDraft(nextDraft);
        return;
      }

      setTransitionBusy(true);

      try {
        openComposeDraft(await hydrateComposeDraftRuntime(mailboxId, cloneComposeDraft(nextDraft)));
      } catch (error) {
        openComposeDraft({
          ...cloneComposeDraft(nextDraft),
          errorMessage: getErrorMessage(error, "Could not reopen that draft."),
          saveStatus: "error",
        });
      } finally {
        setTransitionBusy(false);
      }
    };

    const submitComposeForm = async (values: ComposeFormValues) => {
      if (!mailboxId) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(values);
      const nextSession = cloneComposeSessionState(composeSessionRef.current);
      nextSession.activeDraft = { ...draft, saveStatus: "sending", errorMessage: null };
      setComposeSession(nextSession);

      try {
        const savedDraft = await flushActiveSave();
        await sendComposeDraft(mailboxId, savedDraft);
        clearComposeDraftRuntimeFiles(savedDraft);

        const clearedSession = cloneComposeSessionState(composeSessionRef.current);
        clearedSession.activeDraft = createEmptyComposeDraft();
        setComposeSession(clearedSession);
        resetComposeForm(emptyFormValues);
        setShowCc(false);
        setShowBcc(false);
        setDialogOpen(false);
        await persistSession(clearedSession);
        await Promise.all([
          refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
          refreshCachedMailboxQueries(queryClient, mailboxId, "sent"),
        ]);
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not send message."));
      }
    };

    const discardActiveDraft = async () => {
      if (
        transitionBusy ||
        !mailboxId ||
        activeDraft.saveStatus === "sending" ||
        activeDraft.saveStatus === "saving"
      ) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(getCurrentFormValues());
      const nextSession = cloneComposeSessionState(composeSessionRef.current);
      nextSession.activeDraft = { ...draft, saveStatus: "discarding", errorMessage: null };
      setComposeSession(nextSession);

      try {
        await deleteComposeDraft(mailboxId, draft);
        clearComposeDraftRuntimeFiles(draft);

        const clearedSession = cloneComposeSessionState(composeSessionRef.current);
        if (clearedSession.lastDraft?.localId === draft.localId) {
          clearedSession.lastDraft = null;
        }
        clearedSession.activeDraft = createEmptyComposeDraft();
        setComposeSession(clearedSession);
        resetComposeForm(emptyFormValues);
        setShowCc(false);
        setShowBcc(false);
        setDialogOpen(false);
        await persistSession(clearedSession);
        if (mailboxId) {
          await refreshCachedMailboxQueries(queryClient, mailboxId, "drafts");
        }
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
      if (transitionBusy || activeDraft.saveStatus === "sending") {
        return;
      }

      setTransitionBusy(true);
      clearTimeout(autosaveTimerRef.current);

      try {
        const draft = buildDraftFromForm(getCurrentFormValues());

        if (hasComposeDraftContent(draft) && mailboxId) {
          await flushActiveSave();
          await Promise.all([
            persistSession(),
            refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
          ]);
        } else {
          await persistSession();
        }

        setDialogOpen(false);
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not save draft."));
      } finally {
        setTransitionBusy(false);
      }
    };

    const handleDialogOpenChange = (open: boolean) => {
      if (open) {
        setDialogOpen(true);
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
        const nextSession = cloneComposeSessionState(composeSessionRef.current);
        nextSession.activeDraft = {
          ...nextSession.activeDraft,
          inlineImages: [...nextSession.activeDraft.inlineImages, ...inlineImages],
          saveStatus: "idle",
          errorMessage: null,
          updatedAt: Date.now(),
        };
        setComposeSession(nextSession);

        const nextHtml = attachInlineImagesToHtml(nextSession.activeDraft, inlineImages);
        form.setFieldValue("bodyHtml", nextHtml);
        scheduleAutosave();
      } catch (error) {
        setActiveDraftErrorMessage(getErrorMessage(error, "Could not add those images."));
      }
    };

    useImperativeHandle(ref, () => ({
      openDraft: (draft) => {
        void openRequestedDraft(draft ? cloneComposeDraft(draft) : null);
      },
      openNewMail: () => {
        void openRequestedDraft(null);
      },
    }));

    useEffect(() => {
      if (!mailboxId || loadedMailboxIdRef.current === mailboxId) {
        return;
      }

      loadedMailboxIdRef.current = mailboxId;
      const loadedSession = loadComposeSession(queryClient, mailboxId);
      setComposeSession(loadedSession);
      syncComposeDraftIntoForm(loadedSession.activeDraft);
    }, [mailboxId, queryClient]);

    useEffect(() => {
      return () => {
        clearTimeout(autosaveTimerRef.current);
      };
    }, []);

    const lastDraftExists = Boolean(lastDraft && hasComposeDraftContent(lastDraft));
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
    const discardButtonLabel = activeDraft.draftId ? "Delete draft" : "Discard";

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

                {lastDraftExists ? (
                  <button
                    className="text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    disabled={isBusy}
                    onClick={() => {
                      void continueLastDraft();
                    }}
                    type="button"
                  >
                    Continue last draft
                  </button>
                ) : null}
              </div>

              <div className="space-y-3">
                <form.Field name="to">
                  {(field) => {
                    const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                    return (
                      <div className="space-y-2">
                        <div
                          className={cn(fieldContainerClass, {
                            "bg-destructive/10": Boolean(fieldError),
                          })}
                        >
                          <input
                            aria-invalid={fieldError ? true : undefined}
                            aria-label="Recipients"
                            autoComplete="off"
                            className={fieldInputClass}
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
                              onClick={() => setShowCc((current) => !current)}
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
                              onClick={() => setShowBcc((current) => !current)}
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
                          prefersReducedMotion ? { duration: 0 } : recipientFieldTransition
                        }
                      >
                        <form.Field name="cc">
                          {(field) => {
                            const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                            return (
                              <div className="space-y-2">
                                <div
                                  className={cn(fieldContainerClass, {
                                    "bg-destructive/10": Boolean(fieldError),
                                  })}
                                >
                                  <input
                                    aria-invalid={fieldError ? true : undefined}
                                    aria-label="Cc recipients"
                                    autoComplete="off"
                                    className={fieldInputClass}
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
                          prefersReducedMotion ? { duration: 0 } : recipientFieldTransition
                        }
                      >
                        <form.Field name="bcc">
                          {(field) => {
                            const fieldError = getFieldErrorMessage(field.state.meta.errors[0]);

                            return (
                              <div className="space-y-2">
                                <div
                                  className={cn(fieldContainerClass, {
                                    "bg-destructive/10": Boolean(fieldError),
                                  })}
                                >
                                  <input
                                    aria-invalid={fieldError ? true : undefined}
                                    aria-label="Bcc recipients"
                                    autoComplete="off"
                                    className={fieldInputClass}
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
                    <div className={cn(fieldContainerClass, "mt-3")}>
                      <input
                        aria-label="Subject"
                        autoComplete="off"
                        className={fieldInputClass}
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
                    disabled={isBusy || !mailboxId}
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
                      transitionBusy ||
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
                  disabled={isBusy || !mailboxId}
                  size="sm"
                  type="submit"
                  variant={isBusy ? "outline" : "default"}
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
