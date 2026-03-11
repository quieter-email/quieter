"use client";

import type { QueryClient } from "@tanstack/react-query";
import { AlertCircleIcon, Loading03Icon, MailSend02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button, Dialog, DialogContent, cn } from "@quietr/ui";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import {
  attachInlineImagesToHtml,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  cloneComposeSessionState,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  createInitialComposeSessionState,
  hasComposeDraftContent,
  hydrateComposeDraftRuntime,
  removeComposeRuntimeFile,
  saveComposeDraft,
  sendComposeDraft,
  syncInlineImagesWithHtml,
  validateRecipientInput,
  type ComposeDraftState,
  type ComposeSessionState,
} from "~/lib/gmail/compose";
import { loadComposeSession, persistComposeSession } from "~/lib/gmail/compose-query";
import { refreshLoadedMessagesPages } from "~/lib/gmail/inbox-query";
import { ComposeEditor } from "./compose-editor";

type ComposeDialogProps = {
  composeRequestId: number;
  queryClient: QueryClient;
  userId: string | null;
};

type ComposeFormValues = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  bodyHtml: string;
  bodyText: string;
};

type ComposeFieldName = keyof ComposeFormValues;
type TouchedComposeFields = Partial<Record<ComposeFieldName, boolean>>;

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

const getRecipientValidationMessage = (value: string) =>
  value.trim() && validateRecipientInput(value).length > 0
    ? "One or more recipient addresses are invalid."
    : null;

const getFieldError = (
  fieldName: ComposeFieldName,
  values: ComposeFormValues,
  touchedFields: TouchedComposeFields,
  submissionAttempts: number,
) => {
  if (!touchedFields[fieldName] && submissionAttempts === 0) {
    return null;
  }

  if (fieldName === "to" && submissionAttempts > 0 && !values.to.trim()) {
    return "Add at least one recipient.";
  }

  if (fieldName === "to" || fieldName === "cc" || fieldName === "bcc") {
    return getRecipientValidationMessage(values[fieldName]);
  }

  return null;
};

const getPrimaryValidationMessage = (
  values: ComposeFormValues,
  touchedFields: TouchedComposeFields,
  submissionAttempts: number,
) => {
  const fieldOrder: ComposeFieldName[] = ["to", "cc", "bcc", "subject", "bodyHtml"];

  for (const fieldName of fieldOrder) {
    const message = getFieldError(fieldName, values, touchedFields, submissionAttempts);
    if (message) {
      return message;
    }
  }

  return null;
};

const cloneFormValues = (values: ComposeFormValues): ComposeFormValues => ({
  ...values,
});

export const ComposeDialog = ({ composeRequestId, queryClient, userId }: ComposeDialogProps) => {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [transitionBusy, setTransitionBusy] = useState(false);
  const [composeSession, setComposeSessionState] = useState<ComposeSessionState>(
    createInitialComposeSessionState(),
  );
  const [formValues, setFormValuesState] = useState<ComposeFormValues>(emptyFormValues);
  const [touchedFields, setTouchedFields] = useState<TouchedComposeFields>({});
  const [submissionAttempts, setSubmissionAttempts] = useState(0);

  const composeSessionRef = useRef(composeSession);
  const formValuesRef = useRef(formValues);
  const loadedUserIdRef = useRef("");
  const lastComposeRequestIdRef = useRef(0);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savePromiseRef = useRef<Promise<void> | null>(null);
  const saveQueuedRef = useRef(false);

  useEffect(() => {
    composeSessionRef.current = composeSession;
  }, [composeSession]);

  useEffect(() => {
    formValuesRef.current = formValues;
  }, [formValues]);

  const activeDraft = composeSession.activeDraft;
  const lastDraft = composeSession.lastDraft;
  const composeError =
    activeDraft.errorMessage ??
    getPrimaryValidationMessage(formValues, touchedFields, submissionAttempts);
  const isBusy =
    transitionBusy ||
    activeDraft.saveStatus === "sending" ||
    activeDraft.saveStatus === "discarding";

  const setComposeSession = (next: ComposeSessionState) => {
    composeSessionRef.current = next;
    setComposeSessionState(next);
  };

  const setFormValues = (next: ComposeFormValues) => {
    formValuesRef.current = next;
    setFormValuesState(next);
  };

  const updateFormValues = (updater: (current: ComposeFormValues) => ComposeFormValues) => {
    setFormValues(
      (() => {
        const next = updater(formValuesRef.current);
        return cloneFormValues(next);
      })(),
    );
  };

  const markFieldTouched = (fieldName: ComposeFieldName) => {
    setTouchedFields((current) =>
      current[fieldName] ? current : { ...current, [fieldName]: true },
    );
  };

  const resetComposeForm = (nextValues: ComposeFormValues) => {
    setFormValues(cloneFormValues(nextValues));
    setTouchedFields({});
    setSubmissionAttempts(0);
  };

  const syncComposeDraftIntoForm = (draft: ComposeDraftState) => {
    resetComposeForm(draftToFormValues(draft));
    setShowCc(Boolean(draft.recipients.cc.trim()));
    setShowBcc(Boolean(draft.recipients.bcc.trim()));
  };

  const persistSession = async (session = composeSessionRef.current) => {
    if (!userId) {
      return;
    }

    await persistComposeSession(queryClient, userId, session);
  };

  const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
    const meta = composeSessionRef.current.activeDraft;

    return formValuesToDraft(values, {
      localId: meta.localId,
      draftId: meta.draftId,
      messageId: meta.messageId,
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

    if (!userId) {
      throw new Error("Sign in before composing.");
    }

    const draftSnapshot = buildDraftFromForm(formValuesRef.current);
    if (!hasComposeDraftContent(draftSnapshot)) {
      return draftSnapshot;
    }

    const next = cloneComposeSessionState(composeSessionRef.current);
    next.activeDraft = { ...draftSnapshot, saveStatus: "saving", errorMessage: null };
    setComposeSession(next);

    savePromiseRef.current = (async () => {
      try {
        const savedDraft = await saveComposeDraft(draftSnapshot);
        replaceDraftByLocalId(draftSnapshot.localId, savedDraft);
      } catch (error) {
        replaceDraftByLocalId(draftSnapshot.localId, {
          ...draftSnapshot,
          saveStatus: "error",
          errorMessage: error instanceof Error ? error.message : "Could not save draft.",
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
    return composeSessionRef.current.activeDraft;
  };

  const scheduleAutosave = () => {
    clearTimeout(autosaveTimerRef.current);

    if (isBusy || !userId) {
      return;
    }

    const draft = buildDraftFromForm(formValuesRef.current);
    if (!hasComposeDraftContent(draft)) {
      return;
    }

    autosaveTimerRef.current = setTimeout(() => {
      void flushActiveSave();
    }, 500);
  };

  const openNewMail = () => {
    if (!userId) {
      return;
    }

    clearTimeout(autosaveTimerRef.current);

    const currentDraft = buildDraftFromForm(formValuesRef.current);
    const nextActiveDraft = createEmptyComposeDraft();
    const nextLastDraft = hasComposeDraftContent(currentDraft)
      ? cloneComposeDraft(currentDraft)
      : lastDraft
        ? cloneComposeDraft(lastDraft)
        : null;

    setComposeSession({
      activeDraft: nextActiveDraft,
      lastDraft: nextLastDraft,
    });
    resetComposeForm(emptyFormValues);
    setShowCc(false);
    setShowBcc(false);
    setDialogOpen(true);

    if (hasComposeDraftContent(currentDraft)) {
      const localId = currentDraft.localId;
      const savingSession = cloneComposeSessionState(composeSessionRef.current);
      savingSession.activeDraft = { ...currentDraft, saveStatus: "saving", errorMessage: null };
      setComposeSession(savingSession);

      void saveComposeDraft(currentDraft)
        .then((savedDraft) => replaceDraftByLocalId(localId, savedDraft))
        .catch((error) => {
          replaceDraftByLocalId(localId, {
            ...currentDraft,
            saveStatus: "error",
            errorMessage: error instanceof Error ? error.message : "Could not save draft.",
          });
        });
    }
  };

  const continueLastDraft = async () => {
    if (!userId || !lastDraft) {
      return;
    }

    setTransitionBusy(true);

    try {
      clearTimeout(autosaveTimerRef.current);

      const currentDraft = buildDraftFromForm(formValuesRef.current);
      if (hasComposeDraftContent(currentDraft)) {
        void saveComposeDraft(currentDraft).catch(() => {});
      }

      const hydratedDraft = await hydrateComposeDraftRuntime(cloneComposeDraft(lastDraft));
      const nextSession = cloneComposeSessionState(composeSessionRef.current);
      nextSession.activeDraft = hydratedDraft;
      nextSession.lastDraft = hasComposeDraftContent(currentDraft)
        ? cloneComposeDraft(currentDraft)
        : null;
      setComposeSession(nextSession);
      syncComposeDraftIntoForm(hydratedDraft);
      setDialogOpen(true);
    } finally {
      setTransitionBusy(false);
    }
  };

  const handleSubmit = async () => {
    const nextSubmissionAttempts = submissionAttempts + 1;
    setSubmissionAttempts(nextSubmissionAttempts);

    const validationMessage = getPrimaryValidationMessage(
      formValuesRef.current,
      {
        to: true,
        cc: touchedFields.cc,
        bcc: touchedFields.bcc,
        subject: touchedFields.subject,
        bodyHtml: touchedFields.bodyHtml,
      },
      nextSubmissionAttempts,
    );

    if (validationMessage || !userId) {
      return;
    }

    clearTimeout(autosaveTimerRef.current);
    const draft = buildDraftFromForm(formValuesRef.current);
    const nextSession = cloneComposeSessionState(composeSessionRef.current);
    nextSession.activeDraft = { ...draft, saveStatus: "sending", errorMessage: null };
    setComposeSession(nextSession);

    try {
      const savedDraft = await flushActiveSave();
      await sendComposeDraft(savedDraft);
      clearComposeDraftRuntimeFiles(savedDraft);

      const clearedSession = cloneComposeSessionState(composeSessionRef.current);
      clearedSession.activeDraft = createEmptyComposeDraft();
      setComposeSession(clearedSession);
      resetComposeForm(emptyFormValues);
      setShowCc(false);
      setShowBcc(false);
      setDialogOpen(false);
      await persistSession(clearedSession);
      await refreshLoadedMessagesPages(queryClient, "sent");
    } catch (error) {
      const erroredSession = cloneComposeSessionState(composeSessionRef.current);
      erroredSession.activeDraft = {
        ...erroredSession.activeDraft,
        saveStatus: "error",
        errorMessage: error instanceof Error ? error.message : "Could not send message.",
      };
      setComposeSession(erroredSession);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    setDialogOpen(open);

    if (open) {
      return;
    }

    clearTimeout(autosaveTimerRef.current);
    const draft = buildDraftFromForm(formValuesRef.current);

    if (hasComposeDraftContent(draft) && userId) {
      void flushActiveSave()
        .then(() => persistSession())
        .catch(() => {});
      return;
    }

    void persistSession();
  };

  const addInlineImageFiles = async (files: File[]) => {
    if (files.length === 0) {
      return;
    }

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
    updateFormValues((current) => ({
      ...current,
      bodyHtml: nextHtml,
    }));
    setTouchedFields((current) => ({ ...current, bodyHtml: true }));
    scheduleAutosave();
  };

  useEffect(() => {
    if (!userId || loadedUserIdRef.current === userId) {
      return;
    }

    loadedUserIdRef.current = userId;
    const loadedSession = loadComposeSession(queryClient, userId);
    setComposeSession(loadedSession);
    syncComposeDraftIntoForm(loadedSession.activeDraft);
  }, [queryClient, userId]);

  useEffect(() => {
    if (!userId || composeRequestId === 0 || composeRequestId === lastComposeRequestIdRef.current) {
      return;
    }

    lastComposeRequestIdRef.current = composeRequestId;
    openNewMail();
  }, [composeRequestId, userId]);

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

  return (
    <Dialog onOpenChange={handleDialogOpenChange} open={dialogOpen}>
      <DialogContent className="max-h-[85vh] w-[min(92vw,46rem)] overflow-hidden bg-background-light p-0">
        <div className="max-h-[85vh] overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4 pb-1">
              <div className="space-y-1">
                <p className="text-sm font-semibold tracking-tight text-foreground">New message</p>
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
              <div
                className={cn(fieldContainerClass, {
                  "bg-destructive/10": Boolean(
                    getFieldError("to", formValues, touchedFields, submissionAttempts),
                  ),
                })}
              >
                <input
                  aria-label="Recipients"
                  autoComplete="off"
                  className={fieldInputClass}
                  onBlur={() => markFieldTouched("to")}
                  onChange={(event) => {
                    updateFormValues((current) => ({
                      ...current,
                      to: event.currentTarget.value,
                    }));
                    scheduleAutosave();
                  }}
                  placeholder="To"
                  spellCheck={false}
                  type="text"
                  value={formValues.to}
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

              <AnimatePresence initial={false}>
                {showCc ? (
                  <motion.div
                    animate={{ height: "auto", marginTop: 12, opacity: 1, y: 0 }}
                    className="overflow-hidden"
                    exit={{ height: 0, marginTop: 0, opacity: 0, y: -4 }}
                    id="compose-cc-field"
                    initial={{ height: 0, marginTop: 0, opacity: 0, y: -4 }}
                    transition={recipientFieldTransition}
                  >
                    <div
                      className={cn(fieldContainerClass, {
                        "bg-destructive/10": Boolean(
                          getFieldError("cc", formValues, touchedFields, submissionAttempts),
                        ),
                      })}
                    >
                      <input
                        aria-label="Cc recipients"
                        autoComplete="off"
                        className={fieldInputClass}
                        onBlur={() => markFieldTouched("cc")}
                        onChange={(event) => {
                          updateFormValues((current) => ({
                            ...current,
                            cc: event.currentTarget.value,
                          }));
                          scheduleAutosave();
                        }}
                        placeholder="Cc"
                        spellCheck={false}
                        type="text"
                        value={formValues.cc}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <AnimatePresence initial={false}>
                {showBcc ? (
                  <motion.div
                    animate={{ height: "auto", marginTop: 12, opacity: 1, y: 0 }}
                    className="overflow-hidden"
                    exit={{ height: 0, marginTop: 0, opacity: 0, y: -4 }}
                    id="compose-bcc-field"
                    initial={{ height: 0, marginTop: 0, opacity: 0, y: -4 }}
                    transition={recipientFieldTransition}
                  >
                    <div
                      className={cn(fieldContainerClass, {
                        "bg-destructive/10": Boolean(
                          getFieldError("bcc", formValues, touchedFields, submissionAttempts),
                        ),
                      })}
                    >
                      <input
                        aria-label="Bcc recipients"
                        autoComplete="off"
                        className={fieldInputClass}
                        onBlur={() => markFieldTouched("bcc")}
                        onChange={(event) => {
                          updateFormValues((current) => ({
                            ...current,
                            bcc: event.currentTarget.value,
                          }));
                          scheduleAutosave();
                        }}
                        placeholder="Bcc"
                        spellCheck={false}
                        type="text"
                        value={formValues.bcc}
                      />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>

              <div
                className={cn(fieldContainerClass, "mt-3", {
                  "bg-destructive/10": Boolean(
                    getFieldError("subject", formValues, touchedFields, submissionAttempts),
                  ),
                })}
              >
                <input
                  aria-label="Subject"
                  autoComplete="off"
                  className={fieldInputClass}
                  onBlur={() => markFieldTouched("subject")}
                  onChange={(event) => {
                    updateFormValues((current) => ({
                      ...current,
                      subject: event.currentTarget.value,
                    }));
                    scheduleAutosave();
                  }}
                  placeholder="Subject"
                  type="text"
                  value={formValues.subject}
                />
              </div>
            </div>

            <ComposeEditor
              disabled={isBusy || !userId}
              html={formValues.bodyHtml}
              onBlur={() => markFieldTouched("bodyHtml")}
              onChange={({ html, text }) => {
                updateFormValues((current) => ({
                  ...current,
                  bodyHtml: html,
                  bodyText: text,
                }));
                setTouchedFields((current) => ({ ...current, bodyHtml: true }));
                scheduleAutosave();
              }}
              onInlineImageFiles={addInlineImageFiles}
            />

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

              <Button
                disabled={isBusy || !userId}
                onClick={() => {
                  void handleSubmit();
                }}
                size="sm"
                type="button"
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
        </div>
      </DialogContent>
    </Dialog>
  );
};
