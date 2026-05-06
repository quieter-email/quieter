"use client";

import { composeDraftFormValuesSchema, composeSendFormValuesSchema } from "@quieter/orpc/compose";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { deleteDemoDraft, saveDemoDraft, sendDemoDraft } from "~/lib/gmail/demo-mail";
import { refreshCachedMailboxQueries, removeDraftMessageFromCaches } from "~/lib/gmail/inbox-query";
import { getThreadQueryKey } from "~/lib/gmail/thread-query";
import {
  composeFormValuesToDraft,
  draftToComposeFormValues,
  emptyComposeFormValues,
  shouldPersistComposeDraft,
  writeComposeFormValues,
  type ComposeFormValues,
} from "../domain/compose-form";
import {
  attachInlineImagesToHtml,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  deleteComposeDraft,
  saveComposeDraft,
  sendComposeDraft,
  type ComposeDraftState,
} from "../domain/draft";

type ComposeDialogState = {
  draft: ComposeDraftState;
  open: boolean;
  showBcc: boolean;
  showCc: boolean;
};

const AUTOSAVE_DELAY_MS = 1000;

const createDialogState = (): ComposeDialogState => ({
  draft: createEmptyComposeDraft(),
  open: false,
  showBcc: false,
  showCc: false,
});

export const getDraftStatusMessage = (draft: ComposeDraftState) => {
  if (draft.saveStatus === "sending") return "Sending message...";
  if (draft.saveStatus === "saving") return "Saving draft...";
  if (draft.saveStatus === "error") return "Draft needs attention";
  if (draft.lastSavedAt) return "Draft saved";
  return "Drafts save automatically";
};

export const useComposeDialogController = ({
  demoMode = false,
  mailboxId,
}: {
  demoMode?: boolean;
  mailboxId: string | null;
}) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState(createDialogState);
  const activeDraftRef = useRef(state.draft);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openIdRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());
  const savedDraftByLocalIdRef = useRef(new Map<string, ComposeDraftState>());

  const form = useForm({
    defaultValues: emptyComposeFormValues,
    onSubmit: async ({ value }) => {
      await submitComposeForm(value);
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: composeDraftFormValuesSchema,
      onSubmit: composeSendFormValuesSchema,
    },
  });

  const clearAutosaveTimer = () => {
    clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = undefined;
  };

  const setDraft = (draft: ComposeDraftState) => {
    activeDraftRef.current = draft;
    setState((current) => ({ ...current, draft }));
  };

  const openDraftInDialog = (draft: ComposeDraftState) => {
    activeDraftRef.current = draft;

    writeComposeFormValues(form, draftToComposeFormValues(draft));

    setState({
      draft,
      open: true,
      showBcc: !!draft.recipients.bcc.trim(),
      showCc: !!draft.recipients.cc.trim(),
    });
  };

  const closeDialog = () => {
    setState((current) => ({ ...current, open: false }));
  };

  const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
    const draft = activeDraftRef.current;

    return composeFormValuesToDraft(values, {
      localId: draft.localId,
      draftId: draft.draftId,
      messageId: draft.messageId,
      draftAnchor: draft.draftAnchor,
      replyContext: draft.replyContext,
      attachments: draft.attachments,
      inlineImages: draft.inlineImages,
      saveStatus: "idle",
      errorMessage: null,
      lastSavedAt: draft.lastSavedAt,
      updatedAt: Date.now(),
    });
  };

  const shouldSaveDraft = (draft: ComposeDraftState, values: ComposeFormValues) =>
    !!mailboxId &&
    shouldPersistComposeDraft({
      currentDraft: activeDraftRef.current,
      nextDraft: draft,
      values,
    });

  const refreshThread = async (draft: ComposeDraftState) => {
    if (!mailboxId) return;

    const threadId = draft.replyContext?.threadId ?? draft.draftAnchor?.sourceThreadId;
    if (!threadId) return;

    const queryKey = getThreadQueryKey(mailboxId, threadId);
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.refetchQueries({ queryKey, type: "active" });
  };

  const refreshDrafts = async (draft: ComposeDraftState) => {
    if (!mailboxId) return;
    await Promise.all([
      refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
      refreshThread(draft),
    ]);
  };

  const saveDraft = (
    draft: ComposeDraftState,
    options?: {
      applyToOpenDraft?: boolean;
      openId?: number;
      refreshAfterSave?: boolean;
    },
  ) => {
    if (!mailboxId) {
      return saveQueueRef.current.then(() => draft);
    }

    const task = saveQueueRef.current
      .catch(() => {})
      .then(async () => {
        if (options?.openId && options.openId !== openIdRef.current) {
          return draft;
        }

        if (
          options?.applyToOpenDraft &&
          activeDraftRef.current.localId === draft.localId &&
          activeDraftRef.current.saveStatus !== "sending"
        ) {
          setDraft({ ...activeDraftRef.current, saveStatus: "saving", errorMessage: null });
        }

        const savedDraft = demoMode
          ? await saveDemoDraft(draft)
          : await saveComposeDraft(mailboxId, draft);
        savedDraftByLocalIdRef.current.set(draft.localId, savedDraft);

        if (
          options?.applyToOpenDraft &&
          activeDraftRef.current.localId === draft.localId &&
          activeDraftRef.current.saveStatus !== "sending" &&
          (!options.openId || options.openId === openIdRef.current)
        ) {
          setDraft(savedDraft);
        }

        if (options?.refreshAfterSave) {
          await refreshDrafts(savedDraft);
        }

        return savedDraft;
      });

    saveQueueRef.current = task.then(
      () => {},
      () => {},
    );

    return task;
  };

  const clearActiveDraftError = () => {
    const draft = activeDraftRef.current;
    if (!draft.errorMessage && draft.saveStatus !== "error") return;

    setDraft({
      ...draft,
      errorMessage: null,
      saveStatus: draft.saveStatus === "error" ? "idle" : draft.saveStatus,
    });
  };

  const openComposeDraft = (nextDraft: ComposeDraftState | null) => {
    clearAutosaveTimer();
    openIdRef.current += 1;
    openDraftInDialog(nextDraft ? cloneComposeDraft(nextDraft) : createEmptyComposeDraft());
  };

  const closeComposeDialog = () => {
    if (activeDraftRef.current.saveStatus === "sending") return;

    clearAutosaveTimer();
    openIdRef.current += 1;
    const values = form.state.values;
    const draft = buildDraftFromForm(values);
    const saveOnClose = shouldSaveDraft(draft, values);
    closeDialog();

    if (!saveOnClose) {
      clearComposeDraftRuntimeFiles(draft);
      return;
    }

    void saveDraft(draft, { refreshAfterSave: true })
      .catch(() => {})
      .finally(() => {
        savedDraftByLocalIdRef.current.delete(draft.localId);
        clearComposeDraftRuntimeFiles(draft);
      });
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setState((current) => ({ ...current, open: true }));
      return;
    }

    closeComposeDialog();
  };

  const scheduleAutosave = () => {
    clearAutosaveTimer();
    if (!mailboxId || !state.open || activeDraftRef.current.saveStatus === "sending") return;

    const values = form.state.values;
    const draft = buildDraftFromForm(values);
    if (!shouldSaveDraft(draft, values)) return;

    if (activeDraftRef.current.saveStatus === "saved") {
      setDraft({ ...activeDraftRef.current, saveStatus: "idle" });
    }

    const openId = openIdRef.current;
    autosaveTimerRef.current = setTimeout(() => {
      void saveDraft(draft, { applyToOpenDraft: true, openId }).catch(() => {});
    }, AUTOSAVE_DELAY_MS);
  };

  const submitComposeForm = async (values: ComposeFormValues) => {
    if (!mailboxId) return;

    clearAutosaveTimer();
    const draft = buildDraftFromForm(values);
    setDraft({ ...draft, saveStatus: "sending", errorMessage: null });

    try {
      const savedDraft = await saveDraft(draft);
      setDraft({ ...savedDraft, saveStatus: "sending" });
      if (demoMode) {
        await sendDemoDraft(savedDraft);
      } else {
        await sendComposeDraft(mailboxId, savedDraft);
      }
      closeDialog();
      clearComposeDraftRuntimeFiles(savedDraft);
      await Promise.all([
        refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
        refreshCachedMailboxQueries(queryClient, mailboxId, "sent"),
        refreshThread(savedDraft),
      ]);
    } catch (error) {
      setDraft({
        ...activeDraftRef.current,
        errorMessage: (error as { message?: string })?.message ?? "Could not send message.",
        saveStatus: "error",
      });
    }
  };

  const discardActiveDraft = () => {
    if (activeDraftRef.current.saveStatus === "sending") return;

    clearAutosaveTimer();
    openIdRef.current += 1;
    const draft = buildDraftFromForm(form.state.values);
    closeDialog();

    if (!mailboxId) {
      clearComposeDraftRuntimeFiles(draft);
      return;
    }

    const deleteDraft = async () => {
      await saveQueueRef.current.catch(() => {});
      const savedDraft = savedDraftByLocalIdRef.current.get(draft.localId) ?? draft;

      if (savedDraft.messageId) {
        await removeDraftMessageFromCaches(
          queryClient,
          mailboxId,
          savedDraft.messageId,
          savedDraft.replyContext?.threadId ?? savedDraft.draftAnchor?.sourceThreadId,
        );
      }

      if (savedDraft.draftId) {
        if (demoMode) {
          await deleteDemoDraft(savedDraft);
        } else {
          await deleteComposeDraft(mailboxId, savedDraft);
        }
        if (!savedDraft.messageId) {
          await refreshCachedMailboxQueries(queryClient, mailboxId, "drafts");
        }
        return;
      }

      await refreshCachedMailboxQueries(queryClient, mailboxId, "drafts");
    };

    void deleteDraft()
      .catch(() => {})
      .finally(() => {
        savedDraftByLocalIdRef.current.delete(draft.localId);
        clearComposeDraftRuntimeFiles(draft);
      });
  };

  const toggleRecipientVisibility = (field: "cc" | "bcc") => {
    setState((current) => ({
      ...current,
      showBcc: field === "bcc" ? !current.showBcc : current.showBcc,
      showCc: field === "cc" ? !current.showCc : current.showCc,
    }));
  };

  const addInlineImageFiles = async (files: File[]) => {
    if (files.length === 0) return;

    try {
      clearActiveDraftError();
      const inlineImages = await createComposeInlineImagesFromFiles(files);
      const nextDraft = {
        ...activeDraftRef.current,
        inlineImages: [...activeDraftRef.current.inlineImages, ...inlineImages],
        saveStatus: "idle" as const,
        errorMessage: null,
        updatedAt: Date.now(),
      };

      setDraft(nextDraft);
      form.setFieldValue("bodyHtml", attachInlineImagesToHtml(nextDraft, inlineImages));
      scheduleAutosave();
    } catch (error) {
      setDraft({
        ...activeDraftRef.current,
        errorMessage: (error as { message?: string })?.message ?? "Could not add those images.",
        saveStatus: "error",
      });
    }
  };

  useEffect(() => {
    return () => {
      clearAutosaveTimer();
      clearComposeDraftRuntimeFiles(activeDraftRef.current);
    };
  }, []);

  return {
    addInlineImageFiles,
    clearActiveDraftError,
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    openComposeDraft,
    scheduleAutosave,
    state,
    toggleRecipientVisibility,
  };
};

export type ComposeDialogController = ReturnType<typeof useComposeDialogController>;
