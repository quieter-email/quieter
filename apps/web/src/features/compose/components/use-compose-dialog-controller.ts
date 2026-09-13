"use client";

import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useAgentWorkspace } from "#/features/chat/domain/workspace-context";
import { toastError } from "#/lib/error-toast";
import {
  deleteDemoDraft,
  saveDemoDraft,
  sendDemoDraft,
} from "#/lib/gmail/demo-mail";
import {
  refreshCachedMailboxQueries,
  removeDraftMessageFromCaches,
} from "#/lib/mail/inbox-query";
import { getThreadQueryKey } from "#/lib/mail/thread-query-keys";
import {
  deleteManagedDemoDraft,
  saveManagedDemoDraft,
  sendManagedDemoDraft,
} from "#/lib/managed-mail/demo-managed-mail";
import { isSuppressedRecipientError } from "#/lib/orpc-errors";

import {
  composeFormValuesToDraft,
  draftToComposeFormValues,
  shouldPersistComposeDraft,
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
  hasComposeDraftContent,
  saveComposeDraft,
  sendComposeMessage,
  textToComposeBodyHtml,
} from "../domain/draft";
import type { ComposeDraftState } from "../domain/draft";
import { useDraftAutosave } from "./use-draft-autosave";
import { useDraftRecovery } from "./use-draft-recovery";

type ComposeDraftUpdate =
  | ComposeDraftState
  | ((current: ComposeDraftState) => ComposeDraftState);

const SUPPRESSED_RECIPIENT_MESSAGE =
  "This message includes a recipient that can no longer receive mail from this team.";

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
  onRecipientProblem,
  persistDrafts = true,
  signature,
}: {
  demoMode?: boolean;
  initialDraft?: ComposeDraftState | null;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  onClose?: () => void;
  onRecipientProblem?: () => void;
  persistDrafts?: boolean;
  signature?: { html: string | null; text: string | null };
}) => {
  const queryClient = useQueryClient();
  const agentWorkspace = useAgentWorkspace();
  const assistantUnsavedRef = useRef(initialDraft?.assistantUnsaved === true);
  const [state, setState] = useState(() => {
    const draft = initialDraft
      ? cloneComposeDraft(initialDraft)
      : createEmptyComposeDraft();
    let resolved = draft;
    if (
      (initialDraft?.draftId ?? "") === "" &&
      initialDraft?.recoveryEditorId === undefined
    ) {
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
  const draftClosedRef = useRef(false);
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
      recoveryEditorId: draft.recoveryEditorId,
      recoveryUpdatedAt: draft.recoveryUpdatedAt,
      replyContext: draft.replyContext,
      saveStatus: "idle",
      updatedAt: Date.now(),
    });
  };

  const closeDialog = (afterClose?: () => void) => {
    // oxlint-disable-next-line no-use-before-define -- This handler runs after the form and recovery hooks initialize.
    void recovery.complete(activeDraftRef.current);
    draftClosedRef.current = true;
    setState((current) => ({ ...current, open: false }));
    const closeHandler = afterClose ?? onClose;
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

  const handleSendFailure = (error: unknown) => {
    const isRecipientProblem = isSuppressedRecipientError(error);
    setDraft({
      ...activeDraftRef.current,
      errorMessage: isRecipientProblem
        ? SUPPRESSED_RECIPIENT_MESSAGE
        : "Could not send message. Please try again.",
      saveStatus: "error",
    });
    toastError(error, {
      boundary: "compose-send",
      fallback: "Could not send message. Please try again.",
    });
    if (isRecipientProblem) {
      onRecipientProblem?.();
    }
  };

  const submitComposeForm = async (values: ComposeFormValues) => {
    if (
      mailboxId === null ||
      mailboxId === "" ||
      activeDraftRef.current.saveStatus === "saving" ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }

    const message = buildDraftFromForm(values);
    setDraft(() => ({ ...message, errorMessage: null, saveStatus: "sending" }));
    // oxlint-disable-next-line no-use-before-define -- The form invokes this handler after recovery initializes.
    recovery.checkpoint();

    let draftCleanupHandled = false;
    try {
      if (demoMode) {
        sendDemoDraft(message);
      } else if (managedDemoMode) {
        sendManagedDemoDraft(message);
      } else {
        const sent = await sendComposeMessage(mailboxId ?? "", message);
        draftCleanupHandled =
          "draftCleanupHandled" in sent && sent.draftCleanupHandled;
      }
    } catch (error) {
      handleSendFailure(error);
      return;
    }

    closeDialog();

    if (
      !draftCleanupHandled &&
      message.draftId !== undefined &&
      message.draftId !== ""
    ) {
      try {
        if (demoMode) {
          deleteDemoDraft(message);
        } else if (managedDemoMode) {
          deleteManagedDemoDraft(message);
        } else {
          await deleteComposeDraft(mailboxId, message);
        }
      } catch (error) {
        toastError(error, {
          boundary: "compose-sent-draft-cleanup",
          fallback:
            "Message sent, but its draft could not be removed. Please try deleting it again.",
        });
      }
    }

    try {
      await Promise.all([
        refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "drafts"),
        refreshCachedMailboxQueries(queryClient, mailboxId ?? "", "sent"),
        refreshThread(message),
      ]);
    } catch (error) {
      toastError(error, {
        boundary: "compose-sent-refresh",
        fallback: "Message sent. Refresh to update your mailbox.",
      });
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

  const recovery = useDraftRecovery({
    enabled: persistDrafts && !demoMode && !managedDemoMode,
    getDraft: () => ({
      ...buildDraftFromForm(form.state.values),
      errorMessage: activeDraftRef.current.errorMessage,
      saveStatus: activeDraftRef.current.saveStatus,
    }),
    mailboxId,
    queryClient,
    subscribe: (onChange) => form.store.subscribe(onChange),
  });

  const applyAssistantReceipt = useEffectEvent(
    (
      receipt: Parameters<
        NonNullable<
          ReturnType<NonNullable<typeof agentWorkspace>["getCompose"]>
        >["applyReceipt"]
      >[0],
      matchesRevision: boolean
    ) => {
      if (receipt.draftId !== activeDraftRef.current.localId) {
        return;
      }
      if (receipt.status === "sent") {
        draftClosedRef.current = true;
        void recovery.complete(activeDraftRef.current);
        clearComposeDraftRuntimeFiles(activeDraftRef.current);
        setState((currentState) => ({ ...currentState, open: false }));
        onClose?.();
      } else {
        if (matchesRevision) {
          assistantUnsavedRef.current = false;
        }
        activeDraftRef.current = {
          ...activeDraftRef.current,
          draftId: receipt.providerDraftId,
          lastSavedAt: Date.now(),
          messageId: receipt.messageId,
          saveStatus: matchesRevision ? "saved" : "idle",
        };
        setState((currentState) => ({
          ...currentState,
          draft: activeDraftRef.current,
        }));
      }
    }
  );

  useEffect((): (() => void) | undefined => {
    if (!agentWorkspace || agentWorkspace.mailboxId !== mailboxId) {
      return undefined;
    }
    let revision = 0;
    let previousValues = form.state.values;
    const subscription = form.store.subscribe(() => {
      if (
        ["to", "cc", "bcc", "subject", "bodyText", "bodyHtml"].some(
          (field) =>
            Reflect.get(previousValues, field) !==
            Reflect.get(form.state.values, field)
        )
      ) {
        previousValues = form.state.values;
        revision += 1;
      }
    });
    const unregister = agentWorkspace.registerCompose({
      applyReceipt: (receipt) => {
        const matchesRevision = receipt.draftRevision === revision;
        if (receipt.status === "draft_saved" || matchesRevision) {
          applyAssistantReceipt(receipt, matchesRevision);
        }
      },
      edit: (values, expectedRevision) => {
        if (
          values.bodyText !== undefined &&
          activeDraftRef.current.inlineImages.length > 0
        ) {
          throw new Error(
            "This draft contains images. Edit its message in the composer to keep them intact."
          );
        }
        if (
          expectedRevision !== revision ||
          activeDraftRef.current.saveStatus === "sending" ||
          activeDraftRef.current.saveStatus === "saving"
        ) {
          throw new Error("The draft changed. Read it again before editing.");
        }
        assistantUnsavedRef.current = true;
        for (const field of [
          "to",
          "cc",
          "bcc",
          "subject",
          "bodyText",
        ] as const) {
          const value = values[field];
          if (value !== undefined) {
            form.setFieldValue(field, value);
          }
        }
        if (values.bodyText !== undefined) {
          form.setFieldValue(
            "bodyHtml",
            textToComposeBodyHtml(values.bodyText)
          );
        }
        setState((currentState) => ({
          ...currentState,
          showBcc: form.state.values.bcc.length > 0,
          showCc: form.state.values.cc.length > 0,
        }));
      },
      read: () => ({
        attachments: activeDraftRef.current.attachments,
        draftId: activeDraftRef.current.localId,
        draftRevision: revision,
        inlineImages: activeDraftRef.current.inlineImages,
        providerDraftId: activeDraftRef.current.draftId,
        replyContext: activeDraftRef.current.replyContext,
        values: { ...form.state.values },
      }),
    });
    return () => {
      subscription.unsubscribe();
      unregister();
    };
  }, [agentWorkspace, form, mailboxId]);

  const persistCurrentDraft = async () => {
    const { values } = form.state;
    const draft = buildDraftFromForm(values);
    if (
      persistDrafts &&
      hasComposeDraftContent(draft) &&
      !composeDraftFormValuesSchema.safeParse(values).success
    ) {
      await form.validateAllFields("change");
      setDraft({
        ...draft,
        errorMessage: "Check the recipient addresses before saving your draft.",
        saveStatus: "error",
      });
      return false;
    }
    if (
      mailboxId === null ||
      mailboxId === "" ||
      !persistDrafts ||
      !shouldPersistComposeDraft({
        currentDraft: activeDraftRef.current,
        nextDraft: draft,
        values,
      })
    ) {
      return true;
    }
    setDraft({ ...draft, saveStatus: "saving" });
    recovery.checkpoint();
    let saved: ComposeDraftState;
    try {
      if (demoMode) {
        saved = saveDemoDraft(draft);
      } else if (managedDemoMode) {
        saved = saveManagedDemoDraft(draft);
      } else {
        saved = await saveComposeDraft(mailboxId, draft);
      }
    } catch (error) {
      setDraft({
        ...draft,
        errorMessage: "Your draft could not be saved. Please try again.",
        saveStatus: "error",
      });
      toastError(error, {
        boundary: "compose-save",
        fallback: "Your draft could not be saved. Please try again.",
      });
      return false;
    }
    try {
      await Promise.all([
        refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
        refreshThread(saved),
      ]);
    } catch (error) {
      toastError(error, {
        boundary: "compose-draft-refresh",
        fallback: "Draft saved. Refresh to update your mailbox.",
      });
    }
    setDraft(saved);
    return true;
  };

  useDraftAutosave({
    enabled: persistDrafts && !demoMode && !managedDemoMode,
    mailboxId,
    save: async () => {
      if (
        !assistantUnsavedRef.current &&
        !draftClosedRef.current &&
        activeDraftRef.current.saveStatus !== "saving" &&
        activeDraftRef.current.saveStatus !== "sending" &&
        activeDraftRef.current.saveStatus !== "error" &&
        composeDraftFormValuesSchema.safeParse(form.state.values).success
      ) {
        await persistCurrentDraft();
      }
    },
    subscribe: (onChange) => form.store.subscribe(onChange),
  });

  useBlocker({
    enableBeforeUnload: () => {
      const { values } = form.state;
      const draft = buildDraftFromForm(values);
      return (
        !draftClosedRef.current &&
        hasComposeDraftContent(draft) &&
        (!composeDraftFormValuesSchema.safeParse(values).success ||
          shouldPersistComposeDraft({
            currentDraft: activeDraftRef.current,
            nextDraft: draft,
            values,
          }))
      );
    },
    shouldBlockFn: async () => {
      if (draftClosedRef.current) {
        return false;
      }
      if (
        activeDraftRef.current.saveStatus === "sending" ||
        activeDraftRef.current.saveStatus === "saving"
      ) {
        return true;
      }
      return !(await persistCurrentDraft());
    },
  });

  const handleUserDraftChange = () => {
    assistantUnsavedRef.current = false;
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

  const closeComposeDialog = async (afterClose?: () => void) => {
    if (
      activeDraftRef.current.saveStatus === "sending" ||
      activeDraftRef.current.saveStatus === "saving"
    ) {
      return;
    }
    if (!(await persistCurrentDraft())) {
      return;
    }
    clearComposeDraftRuntimeFiles(activeDraftRef.current);
    closeDialog(afterClose);
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setState((current) => ({ ...current, open: true }));
    } else {
      void closeComposeDialog();
    }
  };

  const discardActiveDraft = async () => {
    if (
      activeDraftRef.current.saveStatus === "sending" ||
      activeDraftRef.current.saveStatus === "saving"
    ) {
      return;
    }
    const draft = activeDraftRef.current;
    setDraft({ ...draft, saveStatus: "saving" });
    try {
      if (
        mailboxId !== null &&
        mailboxId !== "" &&
        draft.draftId !== undefined &&
        draft.draftId !== ""
      ) {
        if (demoMode) {
          deleteDemoDraft(draft);
        } else if (managedDemoMode) {
          deleteManagedDemoDraft(draft);
        } else {
          await deleteComposeDraft(mailboxId, draft);
        }
      }
    } catch (error) {
      setDraft({
        ...draft,
        errorMessage: "Your draft could not be deleted. Please try again.",
        saveStatus: "error",
      });
      toastError(error, { boundary: "compose-discard" });
      return;
    }
    clearComposeDraftRuntimeFiles(draft);
    closeDialog();
    if (mailboxId === null || mailboxId === "") {
      return;
    }
    try {
      if (draft.messageId !== undefined && draft.messageId !== "") {
        await removeDraftMessageFromCaches(
          queryClient,
          mailboxId,
          draft.messageId,
          draft.replyContext?.threadId ?? draft.draftAnchor?.sourceThreadId
        );
      } else {
        await refreshCachedMailboxQueries(queryClient, mailboxId, "drafts");
      }
    } catch (error) {
      toastError(error, {
        boundary: "compose-discard-refresh",
        fallback: "Draft deleted. Refresh to update your mailbox.",
      });
    }
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
      handleUserDraftChange();
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
      toastError(error, { boundary: "compose-inline-images" });
      setDraft({
        ...activeDraftRef.current,
        errorMessage: "Could not add those images.",
        saveStatus: "error",
      });
    }
  };

  return {
    addInlineImageFiles,
    closeComposeDialog,
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    handleUserDraftChange,
    setActiveDraftError,
    state,
    toggleRecipientVisibility,
  };
};

export type ComposeDialogController = ReturnType<
  typeof useComposeDialogController
>;
