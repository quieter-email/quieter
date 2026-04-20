"use client";

import { AlertCircleIcon, Loading03Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { composeDraftFormValuesSchema, composeSendFormValuesSchema } from "@quietr/orpc/compose";
import { Button, Dialog, DialogContent, cn } from "@quietr/ui";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useSelector } from "@tanstack/react-store";
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
  cloneComposeSessionState,
  createComposeInlineImagesFromFiles,
  deleteComposeDraft,
  createEmptyComposeDraft,
  hasComposeDraftContent,
  hydrateComposeDraftRuntime,
  removeComposeRuntimeFile,
  saveComposeDraft,
  sendComposeDraft,
  syncInlineImagesWithHtml,
  type ComposeDraftState,
  type ComposeSessionState,
} from "../domain/draft";
import { loadComposeSession, persistComposeSession } from "../state/compose-query";
import { createComposeDialogStore } from "../state/compose-store";
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

export const ComposeDialog = forwardRef<ComposeDialogHandle, ComposeDialogProps>(
  function ComposeDialog({ mailboxId }, ref) {
    const queryClient = useQueryClient();
    const prefersReducedMotion = useReducedMotion();
    const [composeStore] = useState(createComposeDialogStore);
    const dialogOpen = useSelector(composeStore, (state) => state.dialogOpen);
    const showCc = useSelector(composeStore, (state) => state.showCc);
    const showBcc = useSelector(composeStore, (state) => state.showBcc);
    const transitionBusy = useSelector(composeStore, (state) => state.transitionBusy);
    const activeDraft = useSelector(composeStore, (state) => state.composeSession.activeDraft);
    const lastDraft = useSelector(composeStore, (state) => state.composeSession.lastDraft);
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
    const composeError = activeDraft.errorMessage;
    const isBusy =
      transitionBusy ||
      activeDraft.saveStatus === "sending" ||
      activeDraft.saveStatus === "discarding";

    const getComposeSession = () => composeStore.state.composeSession;

    const setComposeSession = (next: ComposeSessionState) => {
      const nextSession = cloneComposeSessionState(next);

      composeStore.setState((state) => ({
        ...state,
        composeSession: nextSession,
      }));
    };

    const setComposeDialogOpen = (value: boolean) => {
      composeStore.setState((state) => ({
        ...state,
        dialogOpen: value,
      }));
    };

    const setComposeRecipientVisibility = (next: { showBcc?: boolean; showCc?: boolean }) => {
      composeStore.setState((state) => ({
        ...state,
        showBcc: next.showBcc ?? state.showBcc,
        showCc: next.showCc ?? state.showCc,
      }));
    };

    const toggleComposeRecipientVisibility = (field: "cc" | "bcc") => {
      composeStore.setState((state) => ({
        ...state,
        showBcc: field === "bcc" ? !state.showBcc : state.showBcc,
        showCc: field === "cc" ? !state.showCc : state.showCc,
      }));
    };

    const setComposeTransitionBusy = (value: boolean) => {
      composeStore.setState((state) => ({
        ...state,
        transitionBusy: value,
      }));
    };

    const getCurrentFormValues = () => form.state.values;

    const clearActiveDraftError = () => {
      const current = getComposeSession().activeDraft;

      if (!current.errorMessage && current.saveStatus !== "error") {
        return;
      }

      const nextSession = cloneComposeSessionState(getComposeSession());
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
      const nextSession = cloneComposeSessionState(getComposeSession());
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
      setComposeRecipientVisibility({
        showBcc: Boolean(draft.recipients.bcc.trim()),
        showCc: Boolean(draft.recipients.cc.trim()),
      });
    };

    const persistSession = async (session = getComposeSession()) => {
      if (!mailboxId) {
        return;
      }

      await persistComposeSession(queryClient, mailboxId, session);
    };

    const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
      const meta = getComposeSession().activeDraft;

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
      const current = getComposeSession();

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
        return getComposeSession().activeDraft;
      }

      if (!mailboxId) {
        throw new Error("Sign in before composing.");
      }

      const formValues = getCurrentFormValues();
      const draftSnapshot = buildDraftFromForm(formValues);
      if (!hasComposeDraftContent(draftSnapshot) || !canSaveComposeFormValues(formValues)) {
        return draftSnapshot;
      }

      const next = cloneComposeSessionState(getComposeSession());
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
      const savedDraft = getComposeSession().activeDraft;
      if (savedDraft.saveStatus === "error") {
        throw new Error(savedDraft.errorMessage ?? "Could not save draft.");
      }

      return savedDraft;
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

    const mergeHydratedDraft = (
      pendingDraft: ComposeDraftState,
      hydratedDraft: ComposeDraftState,
    ) =>
      ({
        ...hydratedDraft,
        draftAnchor: pendingDraft.draftAnchor ?? hydratedDraft.draftAnchor ?? null,
        localId: pendingDraft.localId,
        recipients: pendingDraft.recipients,
      }) satisfies ComposeDraftState;

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
      const currentSession = getComposeSession();
      const hasCurrentContent =
        hasComposeDraftContent(currentDraft) && canSaveComposeFormValues(currentValues);

      if (hasCurrentContent) {
        void flushActiveSave().catch(() => {});
      }

      const nextActiveDraft = nextDraft ? cloneComposeDraft(nextDraft) : createEmptyComposeDraft();
      const nextLastDraft = hasCurrentContent
        ? cloneComposeDraft(getComposeSession().activeDraft)
        : currentSession.lastDraft
          ? cloneComposeDraft(currentSession.lastDraft)
          : null;
      const nextSession = {
        activeDraft: nextActiveDraft,
        lastDraft: nextLastDraft,
      };

      setComposeSession(nextSession);
      syncComposeDraftIntoForm(nextActiveDraft);
      setComposeDialogOpen(true);
    };

    const continueLastDraft = () => {
      if (!mailboxId || !lastDraft) {
        return;
      }

      openRequestedDraft(cloneComposeDraft(lastDraft));
    };

    const openRequestedDraft = (nextDraft: ComposeDraftState | null) => {
      if (!mailboxId) {
        return;
      }

      const pendingDraft = nextDraft ? cloneComposeDraft(nextDraft) : null;
      openComposeDraft(pendingDraft);

      if (!pendingDraft?.draftId) {
        return;
      }

      const localId = pendingDraft.localId;
      setComposeTransitionBusy(true);

      void hydrateComposeDraftRuntime(mailboxId, cloneComposeDraft(pendingDraft))
        .then((hydratedDraft) => {
          const mergedDraft = mergeHydratedDraft(pendingDraft, hydratedDraft);
          replaceDraftByLocalId(localId, mergedDraft);
          if (getComposeSession().activeDraft.localId === localId) {
            syncComposeDraftIntoForm(mergedDraft);
          }
        })
        .catch((error) => {
          replaceDraftByLocalId(localId, {
            ...pendingDraft,
            errorMessage: getErrorMessage(error, "Could not reopen that draft."),
            saveStatus: "error",
          });
        })
        .finally(() => {
          setComposeTransitionBusy(false);
        });
    };

    const submitComposeForm = async (values: ComposeFormValues) => {
      if (!mailboxId) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(values);
      const nextSession = cloneComposeSessionState(getComposeSession());
      nextSession.activeDraft = { ...draft, saveStatus: "sending", errorMessage: null };
      setComposeSession(nextSession);

      try {
        const savedDraft = await flushActiveSave();
        await sendComposeDraft(mailboxId, savedDraft);
        clearComposeDraftRuntimeFiles(savedDraft);

        const clearedSession = cloneComposeSessionState(getComposeSession());
        clearedSession.activeDraft = createEmptyComposeDraft();
        setComposeSession(clearedSession);
        resetComposeForm(emptyFormValues);
        setComposeRecipientVisibility({
          showBcc: false,
          showCc: false,
        });
        setComposeDialogOpen(false);
        await persistSession(clearedSession);
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
        transitionBusy ||
        !mailboxId ||
        activeDraft.saveStatus === "sending" ||
        activeDraft.saveStatus === "saving"
      ) {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      const draft = buildDraftFromForm(getCurrentFormValues());
      const nextSession = cloneComposeSessionState(getComposeSession());
      nextSession.activeDraft = { ...draft, saveStatus: "discarding", errorMessage: null };
      setComposeSession(nextSession);

      try {
        await deleteComposeDraft(mailboxId, draft);
        clearComposeDraftRuntimeFiles(draft);

        const clearedSession = cloneComposeSessionState(getComposeSession());
        if (clearedSession.lastDraft?.localId === draft.localId) {
          clearedSession.lastDraft = null;
        }
        clearedSession.activeDraft = createEmptyComposeDraft();
        setComposeSession(clearedSession);
        resetComposeForm(emptyFormValues);
        setComposeRecipientVisibility({
          showBcc: false,
          showCc: false,
        });
        setComposeDialogOpen(false);
        await persistSession(clearedSession);
        if (mailboxId) {
          await Promise.all([
            refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
            refreshComposeThread(draft),
          ]);
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

    const closeComposeDialog = () => {
      if (activeDraft.saveStatus === "sending") {
        return;
      }

      clearTimeout(autosaveTimerRef.current);
      setComposeDialogOpen(false);

      if (!mailboxId) {
        return;
      }

      const formValues = getCurrentFormValues();
      const draft = buildDraftFromForm(formValues);
      const shouldSave = hasComposeDraftContent(draft) && canSaveComposeFormValues(formValues);

      const nextSession = cloneComposeSessionState(getComposeSession());
      nextSession.activeDraft = draft;
      setComposeSession(nextSession);

      if (!shouldSave) {
        void persistSession(nextSession).catch(() => {});
        return;
      }

      void (async () => {
        try {
          const savedDraft = await flushActiveSave();
          await refreshComposeThread(savedDraft).catch(() => {});
        } catch {
          // Error is already surfaced on the draft; nothing else to do here.
        }
        await persistSession().catch(() => {});
        await refreshCachedMailboxQueries(queryClient, mailboxId, "drafts").catch(() => {});
      })();
    };

    const handleDialogOpenChange = (open: boolean) => {
      if (open) {
        setComposeDialogOpen(true);
        return;
      }

      closeComposeDialog();
    };

    const addInlineImageFiles = async (files: File[]) => {
      if (files.length === 0) {
        return;
      }

      try {
        clearActiveDraftError();
        const inlineImages = await createComposeInlineImagesFromFiles(files);
        const nextSession = cloneComposeSessionState(getComposeSession());
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
        openRequestedDraft(draft ? cloneComposeDraft(draft) : null);
      },
      openNewMail: () => {
        openRequestedDraft(null);
      },
    }));

    useEffect(() => {
      if (!mailboxId) {
        return;
      }

      const loadedSession = loadComposeSession(queryClient, mailboxId);
      setComposeSession(loadedSession);
      syncComposeDraftIntoForm(loadedSession.activeDraft);
    }, [mailboxId, queryClient]);

    useEffect(() => {
      if (!dialogOpen) {
        return;
      }

      syncComposeDraftIntoForm(activeDraft);
    }, [activeDraft.localId, dialogOpen]);

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
                    onClick={continueLastDraft}
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
