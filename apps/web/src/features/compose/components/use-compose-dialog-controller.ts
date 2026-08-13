"use client";

import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { scheduleFireAndForget } from "#/lib/delay";
import {
  deleteDemoDraft,
  saveDemoDraft,
  sendDemoDraft,
} from "#/lib/gmail/demo-mail";
import {
  refreshCachedMailboxQueries,
  removeDraftMessageFromCaches,
} from "#/lib/gmail/inbox-query";
import { getThreadQueryKey } from "#/lib/gmail/thread-query-keys";
import {
  deleteManagedDemoDraft,
  saveManagedDemoDraft,
  sendManagedDemoDraft,
} from "#/lib/managed-mail/demo-managed-mail";

import {
  composeFormValuesToDraft,
  draftToComposeFormValues,
  shouldPersistComposeDraft,
  writeComposeFormValues,
} from "../domain/compose-form";
import type { ComposeFormValues } from "../domain/compose-form";
import {
  attachInlineImagesToHtml,
  appendComposeSignature,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  deleteComposeDraft,
  saveComposeDraft,
  sendComposeMessage,
} from "../domain/draft";
import type { ComposeDraftState } from "../domain/draft";

type ComposeDraftUpdate =
  | ComposeDraftState
  | ((current: ComposeDraftState) => ComposeDraftState);

const ignoreBackgroundFailure = (): void => undefined;

const getErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && (error.message ?? "") !== "") {
    return error.message;
  }
  return fallback;
};

const chainSaveQueue = (
  saveQueueRef: { current: Promise<unknown> },
  task: Promise<ComposeDraftState>
) => {
  const runChain = async () => {
    try {
      await task;
    } catch {
      ignoreBackgroundFailure();
    }
  };
  saveQueueRef.current = runChain();
};

export const getDraftStatusMessage = (
  draft: ComposeDraftState,
  persistDrafts = true
) => {
  if (draft.saveStatus === "sending") {
    return "Sending message…";
  }
  if (draft.saveStatus === "error") {
    return "Draft needs attention";
  }
  if (!persistDrafts) {
    return "Drafts are kept only while this window is open";
  }
  if (draft.saveStatus === "saving") {
    return "Saving draft…";
  }
  if ((draft.draftId ?? "") !== "" || draft.lastSavedAt !== undefined) {
    return "Draft saved";
  }
  return "Draft saved when you close";
};

export const useComposeDialogController = ({
  demoMode = false,
  initialDraft = null,
  managedDemoMode = false,
  mailboxId,
  onClose,
  persistDrafts = true,
  signature,
}: {
  demoMode?: boolean;
  initialDraft?: ComposeDraftState | null;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onClose?: () => void;
  persistDrafts?: boolean;
  signature?: { html: string | null; text: string | null };
}) => {
  const queryClient = useQueryClient();
  const [state, setState] = useState(() => {
    const draft = initialDraft
      ? cloneComposeDraft(initialDraft)
      : createEmptyComposeDraft();
    let resolved = draft;
    if ((initialDraft?.draftId ?? "") === "") {
      resolved = appendComposeSignature(
        draft,
        signature ?? { html: undefined, text: undefined }
      );
    }
    return {
      draft: resolved,
      open: true,
      showBcc: resolved.recipients.bcc.trim() !== "",
      showCc: resolved.recipients.cc.trim() !== "",
    };
  });
  const activeDraftRef = useRef(state.draft);
  const onCloseRef = useRef(onClose);
  const openIdRef = useRef(0);
  // react-doctor-disable-next-line react-doctor/rerender-lazy-ref-init -- The queue promise is a stable mutable workflow primitive.
  const saveQueueRef = useRef(Promise.resolve());
  const savedDraftByLocalIdRef = useRef(new Map<string, ComposeDraftState>());

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const setDraft = (update: ComposeDraftUpdate) => {
    const draft =
      typeof update === "function" ? update(activeDraftRef.current) : update;
    activeDraftRef.current = draft;
    setState((current) => ({ ...current, draft }));
  };

  const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
    const draft = activeDraftRef.current;

    return composeFormValuesToDraft(values, {
      attachments: draft.attachments,
      draftAnchor: draft.draftAnchor,
      draftId: draft.draftId,
      errorMessage: null,
      inlineImages: draft.inlineImages,
      lastSavedAt: draft.lastSavedAt,
      localId: draft.localId,
      messageId: draft.messageId,
      replyContext: draft.replyContext,
      saveStatus: "idle",
      updatedAt: Date.now(),
    });
  };

  const closeDialog = (afterClose?: () => void) => {
    setState((current) => ({ ...current, open: false }));
    const closeHandler = afterClose ?? onCloseRef.current;
    if (closeHandler !== undefined) {
      closeHandler();
    }
  };

  const refreshThread = async (draft: ComposeDraftState) => {
    if ((mailboxId ?? "") === "") {
      return;
    }

    const threadId =
      draft.replyContext?.threadId ?? draft.draftAnchor?.sourceThreadId;
    if ((threadId ?? "") === "") {
      return;
    }

    const queryKey = getThreadQueryKey(mailboxId ?? "", threadId ?? "");
    await queryClient.invalidateQueries({ queryKey });
    await queryClient.refetchQueries({ queryKey, type: "active" });
  };

  const submitComposeForm = async (values: ComposeFormValues) => {
    if ((mailboxId ?? "") === "") {
      return;
    }

    const message = buildDraftFromForm(values);
    setDraft(() => ({ ...message, errorMessage: null, saveStatus: "sending" }));

    try {
      if (demoMode) {
        sendDemoDraft(message);
      } else if (managedDemoMode) {
        sendManagedDemoDraft(message);
      } else {
        await sendComposeMessage(mailboxId ?? "", message);
      }
    } catch (error) {
      setDraft({
        ...activeDraftRef.current,
        errorMessage: getErrorMessage(error, "Could not send message."),
        saveStatus: "error",
      });
      return;
    }

    closeDialog();

    try {
      await saveQueueRef.current;
    } catch {
      ignoreBackgroundFailure();
    }
    const savedDraft =
      savedDraftByLocalIdRef.current.get(message.localId) ?? message;

    if ((savedDraft.draftId ?? "") !== "") {
      try {
        if (demoMode) {
          deleteDemoDraft(savedDraft);
        } else if (managedDemoMode) {
          deleteManagedDemoDraft(savedDraft);
        } else {
          await deleteComposeDraft(mailboxId ?? "", savedDraft);
        }
      } catch {
        ignoreBackgroundFailure();
      }
    }

    savedDraftByLocalIdRef.current.delete(message.localId);
    try {
      await Promise.all([
        refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "drafts"),
        refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "sent"),
        refreshThread(message),
      ]);
    } catch {
      ignoreBackgroundFailure();
    }
    clearComposeDraftRuntimeFiles(message);
  };

  const form = useForm({
    defaultValues: draftToComposeFormValues(state.draft),
    onSubmit: async ({ value }) => {
      await submitComposeForm(value);
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: composeDraftFormValuesSchema,
      onSubmit: composeSendFormValuesSchema,
    },
  });

  const openDraftInDialog = (draft: ComposeDraftState) => {
    activeDraftRef.current = draft;

    writeComposeFormValues(form, draftToComposeFormValues(draft));

    setState({
      draft,
      open: true,
      showBcc: draft.recipients.bcc.trim() !== "",
      showCc: draft.recipients.cc.trim() !== "",
    });
  };

  const shouldSaveDraft = (
    draft: ComposeDraftState,
    values: ComposeFormValues
  ) =>
    (mailboxId ?? "") !== "" &&
    persistDrafts &&
    shouldPersistComposeDraft({
      currentDraft: activeDraftRef.current,
      nextDraft: draft,
      values,
    });

  const refreshDrafts = async (draft: ComposeDraftState) => {
    if ((mailboxId ?? "") === "") {
      return;
    }
    await Promise.all([
      refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "drafts"),
      refreshThread(draft),
    ]);
  };

  const saveDraft = async (
    draft: ComposeDraftState,
    options?: {
      applyToOpenDraft?: boolean;
      openId?: number;
      refreshAfterSave?: boolean;
    }
  ) => {
    if ((mailboxId ?? "") === "") {
      try {
        await saveQueueRef.current;
      } catch {
        ignoreBackgroundFailure();
      }
      return draft;
    }

    const task = (async () => {
      try {
        await saveQueueRef.current;
      } catch {
        ignoreBackgroundFailure();
      }

      if (
        options?.openId !== undefined &&
        options.openId !== openIdRef.current
      ) {
        return draft;
      }

      if (
        options?.applyToOpenDraft === true &&
        activeDraftRef.current.localId === draft.localId &&
        activeDraftRef.current.saveStatus !== "sending"
      ) {
        setDraft({
          ...activeDraftRef.current,
          errorMessage: null,
          saveStatus: "saving",
        });
      }

      let savedDraft: ComposeDraftState;
      if (demoMode) {
        savedDraft = saveDemoDraft(draft);
      } else if (managedDemoMode) {
        savedDraft = await saveManagedDemoDraft(draft);
      } else {
        savedDraft = await saveComposeDraft(mailboxId ?? "", draft);
      }
      savedDraftByLocalIdRef.current.set(draft.localId, savedDraft);

      if (
        options?.applyToOpenDraft === true &&
        activeDraftRef.current.localId === draft.localId &&
        activeDraftRef.current.saveStatus !== "sending" &&
        (options.openId === undefined || options.openId === openIdRef.current)
      ) {
        setDraft(savedDraft);
      }

      if (options?.refreshAfterSave === true) {
        await refreshDrafts(savedDraft);
      }

      return savedDraft;
    })();

    chainSaveQueue(saveQueueRef, task);

    return await task;
  };

  const clearActiveDraftError = () => {
    const draft = activeDraftRef.current;
    if ((draft.errorMessage ?? "") === "" && draft.saveStatus !== "error") {
      return;
    }

    setDraft((current) => ({
      ...current,
      errorMessage: null,
      saveStatus: current.saveStatus === "error" ? "idle" : current.saveStatus,
    }));
  };

  const setActiveDraftError = (message: string) => {
    setDraft({
      ...activeDraftRef.current,
      errorMessage: message,
      saveStatus: "error",
    });
  };

  const openComposeDraft = (nextDraft: ComposeDraftState | null) => {
    openIdRef.current += 1;
    const draft = nextDraft
      ? cloneComposeDraft(nextDraft)
      : createEmptyComposeDraft();
    let withSignature = draft;
    if ((nextDraft?.draftId ?? "") === "") {
      withSignature = appendComposeSignature(
        draft,
        signature ?? { html: undefined, text: undefined }
      );
    }
    openDraftInDialog(withSignature);
  };

  const closeComposeDialog = (afterClose?: () => void) => {
    if (activeDraftRef.current.saveStatus === "sending") {
      return;
    }

    openIdRef.current += 1;
    const { values } = form.state;
    const draft = buildDraftFromForm(values);
    const saveOnClose = shouldSaveDraft(draft, values);
    closeDialog(afterClose);

    if (!saveOnClose) {
      clearComposeDraftRuntimeFiles(draft);
      return;
    }

    const finishClose = async () => {
      await saveDraft(draft, { refreshAfterSave: true })
        .catch(() => {
          ignoreBackgroundFailure();
        })
        .finally(() => {
          savedDraftByLocalIdRef.current.delete(draft.localId);
          clearComposeDraftRuntimeFiles(draft);
        });
    };
    scheduleFireAndForget(finishClose);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setState((current) => ({ ...current, open: true }));
      return;
    }

    closeComposeDialog();
  };

  const discardActiveDraft = () => {
    if (activeDraftRef.current.saveStatus === "sending") {
      return;
    }

    openIdRef.current += 1;
    const draft = buildDraftFromForm(form.state.values);
    closeDialog();

    if ((mailboxId ?? "") === "") {
      clearComposeDraftRuntimeFiles(draft);
      return;
    }

    const deleteDraft = async () => {
      try {
        await saveQueueRef.current;
      } catch {
        ignoreBackgroundFailure();
      }
      const savedDraft =
        savedDraftByLocalIdRef.current.get(draft.localId) ?? draft;

      if ((savedDraft.messageId ?? "") !== "") {
        await removeDraftMessageFromCaches(
          queryClient,
          mailboxId ?? "",
          savedDraft.messageId ?? "",
          savedDraft.replyContext?.threadId ??
            savedDraft.draftAnchor?.sourceThreadId
        );
      }

      if ((savedDraft.draftId ?? "") !== "") {
        if (demoMode) {
          deleteDemoDraft(savedDraft);
        } else if (managedDemoMode) {
          deleteManagedDemoDraft(savedDraft);
        } else {
          await deleteComposeDraft(mailboxId ?? "", savedDraft);
        }
        if ((savedDraft.messageId ?? "") === "") {
          await refreshCachedMailboxQueries(
            queryClient,
            mailboxId ?? "",
            "drafts"
          );
        }
        return;
      }

      await refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "drafts");
    };

    const finishDiscard = async () => {
      await deleteDraft()
        .catch(() => {
          ignoreBackgroundFailure();
        })
        .finally(() => {
          savedDraftByLocalIdRef.current.delete(draft.localId);
          clearComposeDraftRuntimeFiles(draft);
        });
    };
    scheduleFireAndForget(finishDiscard);
  };

  const toggleRecipientVisibility = (field: "cc" | "bcc") => {
    setState((current) => ({
      ...current,
      showBcc: field === "bcc" ? !current.showBcc : current.showBcc,
      showCc: field === "cc" ? !current.showCc : current.showCc,
    }));
  };

  const addInlineImageFiles = (files: File[]) => {
    if (files.length === 0) {
      return;
    }

    try {
      clearActiveDraftError();
      const inlineImages = createComposeInlineImagesFromFiles(files);
      const nextDraft = {
        ...activeDraftRef.current,
        errorMessage: null,
        inlineImages: [...activeDraftRef.current.inlineImages, ...inlineImages],
        saveStatus: "idle" as const,
        updatedAt: Date.now(),
      };

      setDraft(nextDraft);
      form.setFieldValue(
        "bodyHtml",
        attachInlineImagesToHtml(nextDraft, inlineImages)
      );
    } catch (error) {
      setDraft({
        ...activeDraftRef.current,
        errorMessage: getErrorMessage(error, "Could not add those images."),
        saveStatus: "error",
      });
    }
  };

  // react-doctor-disable-next-line react-doctor/exhaustive-deps
  useEffect(
    () => () => {
      clearComposeDraftRuntimeFiles(activeDraftRef.current);
    },
    []
  );

  return {
    addInlineImageFiles,
    clearActiveDraftError,
    closeComposeDialog,
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    openComposeDraft,
    setActiveDraftError,
    state,
    toggleRecipientVisibility,
  };
};

export type ComposeDialogController = ReturnType<
  typeof useComposeDialogController
>;
