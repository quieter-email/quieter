"use client";

import { useAgentWorkspace } from "@quieter/app/features/chat/domain/workspace-context";
import { useDraftAutosave } from "@quieter/app/features/compose/components/use-draft-autosave";
import { useDraftRecovery } from "@quieter/app/features/compose/components/use-draft-recovery";
import {
  getReferencedComposeActionImages,
  prepareComposeActionQuote,
  replaceComposeActionQuote,
} from "@quieter/app/features/compose/domain/compose-action-quote";
import type { ComposeActionDraft } from "@quieter/app/features/compose/domain/compose-action-quote";
import {
  composeFormValuesToDraft,
  draftToComposeFormValues,
  shouldPersistComposeDraft,
} from "@quieter/app/features/compose/domain/compose-form";
import type { ComposeFormValues } from "@quieter/app/features/compose/domain/compose-form";
import {
  attachInlineImagesToHtml,
  addComposeAttachmentFiles,
  appendComposeSignature,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  cloneComposeDraftRuntimeFiles,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  deleteComposeDraft,
  removeComposeRuntimeFile,
  hasComposeDraftContent,
  haveComposeDraftPersistedFieldsChanged,
  prepareLoadedComposeDraft,
  saveComposeDraft,
  sendComposeMessage,
  textToComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { findRecoverableComposeDraft } from "@quieter/app/features/compose/domain/draft-recovery";
import { authClient } from "@quieter/app/lib/auth";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  deleteDemoDraft,
  saveDemoDraft,
  sendDemoDraft,
} from "@quieter/app/lib/gmail/demo-mail";
import {
  refreshCachedMailboxQueries,
  removeDraftMessageFromCaches,
} from "@quieter/app/lib/mail/inbox-query/index";
import { getThreadQueryKey } from "@quieter/app/lib/mail/thread-query-keys";
import {
  deleteManagedDemoDraft,
  saveManagedDemoDraft,
  sendManagedDemoDraft,
} from "@quieter/app/lib/managed-mail/demo-managed-mail";
import { rpc } from "@quieter/app/lib/orpc";
import {
  isSuppressedRecipientError,
  shouldRetryOrpcError,
} from "@quieter/app/lib/orpc-errors";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState } from "react";

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
  if (draft.saveStatus === "saved") {
    return "Draft saved";
  }
  return "Unsaved changes";
};

export const useComposeDialogController = ({
  autosavePaused = false,
  beforeNavigate,
  demoMode = false,
  defaultSenderName,
  initialDraft = null,
  initialDraftNeedsSave = false,
  managedDemoMode = false,
  mailboxId,
  normalizeHtml,
  getTextFromHtml,
  onClose,
  onRecipientProblem,
  persistDrafts = true,
  signature,
}: {
  autosavePaused?: boolean;
  beforeNavigate?: () => Promise<void>;
  demoMode?: boolean;
  defaultSenderName?: string;
  initialDraft?: ComposeActionDraft | null;
  initialDraftNeedsSave?: boolean;
  managedDemoMode?: boolean;
  mailboxId: string | null;
  normalizeHtml: (html: string) => string;
  getTextFromHtml: (html: string) => string;
  onClose?: () => void;
  onRecipientProblem?: () => void;
  persistDrafts?: boolean;
  signature?: { html: string | null; text: string | null };
}) => {
  const userId = authClient.useSession().data?.user.id;
  const queryClient = useQueryClient();
  const agentWorkspace = useAgentWorkspace();
  const [state, setState] = useState<{
    draft: ComposeDraftState;
    isFinishing: boolean;
    open: boolean;
    showBcc: boolean;
    showCc: boolean;
  }>(() => {
    const seed = initialDraft ?? createEmptyComposeDraft();
    const draft = cloneComposeDraft(
      persistDrafts &&
        !demoMode &&
        !managedDemoMode &&
        mailboxId &&
        userId &&
        seed.recoveryEditorId === undefined &&
        !seed.draftId &&
        !seed.inlineImages.some((image) => !!image.gmailAttachmentId)
        ? (findRecoverableComposeDraft({ mailboxId, userId }, seed) ?? seed)
        : seed
    );
    let resolved = draft;
    draft.senderName =
      defaultSenderName === undefined
        ? undefined
        : (draft.senderName ?? defaultSenderName);
    if ((draft.draftId ?? "") === "" && draft.recoveryEditorId === undefined) {
      resolved = appendComposeSignature(
        draft,
        signature ?? { html: undefined, text: undefined }
      );
    }
    return {
      draft: {
        ...resolved,
        sendOperationId:
          resolved.sendOperationId ??
          (resolved.sendUncertain === true ? undefined : crypto.randomUUID()),
      },
      isFinishing: false,
      open: true,
      showBcc: resolved.recipients.bcc.trim() !== "",
      showCc: resolved.recipients.cc.trim() !== "",
    };
  });
  // oxlint-disable-next-line react/hook-use-state -- Later draft and action changes write the form explicitly.
  const [defaultValues] = useState(() => draftToComposeFormValues(state.draft));
  const assistantUnsavedRef = useRef(state.draft.assistantUnsaved === true);
  const needsSaveRef = useRef(initialDraftNeedsSave && persistDrafts);
  const activeDraftRef = useRef(state.draft);
  const runtimeDraftRef = useRef(state.draft);
  const lastSavedDraftRef = useRef(state.draft);
  const recoveredChangesRef = useRef(
    state.draft.recoveryEditorId !== undefined ||
      (state.draft.saveStatus === "idle" && !!state.draft.draftId)
  );
  const draftClosedRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const finishingRef = useRef(false);
  const senderRouteMailboxIdRef = useRef<string | null>(null);
  const navigationCleanupRef = useRef(false);
  const senderSourceUnavailableRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const retryableSaveErrorRef = useRef(false);
  const saveErrorReportedRef = useRef(false);
  const saveConflictRef = useRef(false);
  const [canSaveDraftCopy, setCanSaveDraftCopy] = useState(false);
  const previousActionRef = useRef({
    attachments: state.draft.draftId
      ? []
      : (initialDraft?.actionQuote?.attachments ?? []),
    html: initialDraft?.actionQuote?.html ?? state.draft.bodyHtml,
    inlineImages: state.draft.inlineImages,
    seededBy: state.draft.draftAnchor?.seededBy,
    sourceMessageId: state.draft.draftAnchor?.sourceMessageId,
  });
  const actionRunningRef = useRef(false);
  const queuedActionRef = useRef<ComposeActionDraft | null>(null);
  const setDraft = (update: ComposeDraftUpdate) => {
    let draft =
      typeof update === "function" ? update(activeDraftRef.current) : update;
    if (
      draft.errorMessage === null &&
      (draft.recoveryMissingFiles?.length ?? 0) > 0
    ) {
      draft = {
        ...draft,
        errorMessage: `Your text was recovered. Reattach these files before sending: ${draft.recoveryMissingFiles?.join(", ") ?? ""}.`,
      };
    }
    activeDraftRef.current = draft;
    runtimeDraftRef.current = {
      ...draft,
      attachments: [
        ...runtimeDraftRef.current.attachments.filter(
          (asset) =>
            !draft.attachments.some((current) => current.id === asset.id)
        ),
        ...draft.attachments,
      ],
      inlineImages: [
        ...runtimeDraftRef.current.inlineImages.filter(
          (asset) =>
            !draft.inlineImages.some((current) => current.id === asset.id)
        ),
        ...draft.inlineImages,
      ],
    };
    setState((current) => ({ ...current, draft }));
  };

  const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
    const draft = activeDraftRef.current;

    return composeFormValuesToDraft(values, {
      attachments: draft.attachments,
      baseRevision: draft.baseRevision,
      draftAnchor: draft.draftAnchor,
      draftId: draft.draftId,
      errorMessage: null,
      inlineImages: draft.inlineImages,
      lastSavedAt: draft.lastSavedAt,
      localId: draft.localId,
      messageId: draft.messageId,
      recoveryEditorId: draft.recoveryEditorId,
      recoveryLocalId: draft.recoveryLocalId,
      recoveryMissingFiles: draft.recoveryMissingFiles,
      recoveryUpdatedAt: draft.recoveryUpdatedAt,
      replyContext: draft.replyContext,
      saveStatus: "idle",
      sendOperationId: draft.sendOperationId,
      sendUncertain: draft.sendUncertain,
      updatedAt: Date.now(),
    });
  };

  const closeDialog = (afterClose?: () => void, preserveRecovery = false) => {
    if (preserveRecovery) {
      // oxlint-disable-next-line no-use-before-define -- This handler runs after recovery initializes.
      recovery.checkpoint();
    } else {
      // oxlint-disable-next-line no-use-before-define -- This handler runs after recovery initializes.
      void recovery.complete(activeDraftRef.current);
    }
    draftClosedRef.current = true;
    clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
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
  };

  const handleSendFailure = (error: unknown) => {
    const isRecipientProblem = isSuppressedRecipientError(error);
    const deliveryUncertain =
      typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof error.data === "object" &&
      error.data !== null &&
      "deliveryUncertain" in error.data &&
      error.data.deliveryUncertain === true;
    saveConflictRef.current =
      typeof error === "object" &&
      error !== null &&
      "data" in error &&
      typeof error.data === "object" &&
      error.data !== null &&
      "draftConflict" in error.data &&
      error.data.draftConflict === true;
    setCanSaveDraftCopy(saveConflictRef.current);
    let errorMessage = "Could not send message. Please try again.";
    if (deliveryUncertain) {
      errorMessage =
        "Delivery could not be confirmed. Check Sent before sending again.";
    } else if (isRecipientProblem) {
      errorMessage = SUPPRESSED_RECIPIENT_MESSAGE;
    } else if (saveConflictRef.current) {
      errorMessage =
        "This draft changed elsewhere. Save a copy to keep your changes.";
    }
    setDraft({
      ...activeDraftRef.current,
      errorMessage,
      saveStatus: "error",
      sendUncertain: deliveryUncertain,
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
    if (activeDraftRef.current.sendUncertain === true) {
      // oxlint-disable-next-line no-use-before-define -- Submission runs after the delivery handler initializes.
      await checkSendDelivery();
      return;
    }
    if (
      mailboxId === null ||
      mailboxId === "" ||
      finishingRef.current ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }

    setDraft((current) => ({
      ...current,
      errorMessage: null,
      saveStatus: "sending",
      sendOperationId: current.sendOperationId ?? crypto.randomUUID(),
    }));
    await savingRef.current;
    const message = buildDraftFromForm(values);
    setDraft({ ...message, saveStatus: "sending" });
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
    defaultValues,
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
    enabled: persistDrafts && !demoMode && !managedDemoMode && state.open,
    getDraft: () => ({
      ...buildDraftFromForm(form.state.values),
      assistantUnsaved: assistantUnsavedRef.current,
      errorMessage: activeDraftRef.current.errorMessage,
      saveStatus: activeDraftRef.current.saveStatus,
    }),
    mailboxId,
    queryClient,
    subscribe: (onChange) => form.store.subscribe(onChange),
  });

  const mountedRef = useRef(false);
  const releaseUnmountedDraft = useEffectEvent(async () => {
    const draft = buildDraftFromForm(form.state.values);
    clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
    if (
      !draftClosedRef.current &&
      !needsSaveRef.current &&
      !senderSourceUnavailableRef.current &&
      activeDraftRef.current.sendUncertain !== true &&
      activeDraftRef.current.saveStatus !== "sending" &&
      composeDraftFormValuesSchema.safeParse(form.state.values).success &&
      !shouldPersistComposeDraft({
        currentDraft: {
          ...lastSavedDraftRef.current,
          saveStatus: recoveredChangesRef.current
            ? "error"
            : activeDraftRef.current.saveStatus,
        },
        nextDraft: draft,
        values: form.state.values,
      })
    ) {
      await recovery.complete(draft);
      if (navigationCleanupRef.current) {
        try {
          await beforeNavigate?.();
        } catch (error) {
          toastError(error, {
            boundary: "compose-inactive-draft-cleanup",
            fallback:
              "An older draft could not be removed. You can delete it from Drafts.",
          });
        }
      }
    }
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) {
          void releaseUnmountedDraft();
        }
      });
    };
  }, []);

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
        clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
        setState((currentState) => ({ ...currentState, open: false }));
        onClose?.();
      } else {
        if (matchesRevision) {
          assistantUnsavedRef.current = false;
        }
        const draft = {
          ...activeDraftRef.current,
          attachments: activeDraftRef.current.attachments.map(
            (asset) =>
              receipt.attachments?.find((saved) => saved.id === asset.id) ??
              asset
          ),
          baseRevision: receipt.baseRevision,
          draftId: receipt.providerDraftId,
          inlineImages: activeDraftRef.current.inlineImages.map(
            (asset) =>
              receipt.inlineImages?.find((saved) => saved.id === asset.id) ??
              asset
          ),
          lastSavedAt: Date.now(),
          messageId: receipt.messageId,
          saveStatus: matchesRevision ? ("saved" as const) : ("idle" as const),
        };
        setDraft(draft);
        if (matchesRevision) {
          lastSavedDraftRef.current = buildDraftFromForm(form.state.values);
          needsSaveRef.current = false;
          recoveredChangesRef.current = false;
        }
        recovery.checkpoint();
      }
    }
  );

  useEffect((): (() => void) | undefined => {
    if (!agentWorkspace || agentWorkspace.mailboxId !== mailboxId) {
      return undefined;
    }
    let previousValues = form.state.values;
    const subscription = form.store.subscribe(() => {
      if (
        [
          "to",
          "cc",
          "bcc",
          "senderName",
          "subject",
          "bodyText",
          "bodyHtml",
        ].some(
          (field) =>
            Reflect.get(previousValues, field) !==
            Reflect.get(form.state.values, field)
        )
      ) {
        previousValues = form.state.values;
        draftRevisionRef.current += 1;
      }
    });
    const unregister = agentWorkspace.registerCompose({
      applyReceipt: (receipt) => {
        const matchesRevision =
          receipt.draftRevision === draftRevisionRef.current;
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
          expectedRevision !== draftRevisionRef.current ||
          activeDraftRef.current.sendUncertain === true ||
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
        setDraft((current) => ({
          ...current,
          errorMessage: null,
          saveStatus: "idle",
        }));
      },
      read: () => ({
        attachments: activeDraftRef.current.attachments,
        baseRevision: activeDraftRef.current.baseRevision,
        draftAnchor: activeDraftRef.current.draftAnchor,
        draftId: activeDraftRef.current.localId,
        draftRevision: draftRevisionRef.current,
        inlineImages: activeDraftRef.current.inlineImages,
        messageId: activeDraftRef.current.messageId,
        providerDraftId: activeDraftRef.current.draftId,
        replyContext: activeDraftRef.current.replyContext,
        sendOperationId: activeDraftRef.current.sendOperationId,
        sendUncertain: activeDraftRef.current.sendUncertain,
        values: { ...form.state.values },
      }),
    });
    return () => {
      subscription.unsubscribe();
      unregister();
    };
  }, [agentWorkspace, form, mailboxId]);

  const persistDraftSnapshot = async (hydrateAttachments = false) => {
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
      (!needsSaveRef.current &&
        !hydrateAttachments &&
        !shouldPersistComposeDraft({
          currentDraft: {
            ...lastSavedDraftRef.current,
            saveStatus: recoveredChangesRef.current
              ? "error"
              : activeDraftRef.current.saveStatus,
          },
          nextDraft: draft,
          values,
        }))
    ) {
      return true;
    }
    setDraft({
      ...draft,
      inlineImages: activeDraftRef.current.inlineImages,
      saveStatus: "saving",
    });
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
      retryableSaveErrorRef.current = shouldRetryOrpcError(0, error);
      const data =
        typeof error === "object" && error !== null && "data" in error
          ? error.data
          : undefined;
      saveConflictRef.current =
        typeof data === "object" &&
        data !== null &&
        "draftConflict" in data &&
        data.draftConflict === true;
      setCanSaveDraftCopy(saveConflictRef.current);
      const deliveryUncertain =
        typeof data === "object" &&
        data !== null &&
        "deliveryUncertain" in data &&
        data.deliveryUncertain === true;
      setDraft({
        ...activeDraftRef.current,
        errorMessage: deliveryUncertain
          ? "Delivery could not be confirmed. Check Sent before sending again."
          : "Your draft could not be saved. Please try again.",
        saveStatus:
          activeDraftRef.current.saveStatus === "sending" ? "sending" : "error",
        sendUncertain:
          deliveryUncertain || activeDraftRef.current.sendUncertain === true,
      });
      if (!saveErrorReportedRef.current) {
        saveErrorReportedRef.current = true;
        toastError(error, {
          boundary: "compose-save",
          fallback: "Your draft could not be saved. Please try again.",
        });
      }
      return false;
    }
    lastSavedDraftRef.current = saved;
    needsSaveRef.current = false;
    recoveredChangesRef.current = false;
    retryableSaveErrorRef.current = false;
    saveErrorReportedRef.current = false;
    saveConflictRef.current = false;
    setCanSaveDraftCopy(false);
    const current = buildDraftFromForm(form.state.values);
    const attachments = activeDraftRef.current.attachments.map(
      (attachment) =>
        saved.attachments.find((asset) => asset.id === attachment.id) ??
        attachment
    );
    const inlineImages = activeDraftRef.current.inlineImages.map(
      (image) =>
        saved.inlineImages.find((asset) => asset.id === image.id) ?? image
    );
    let saveStatus: ComposeDraftState["saveStatus"] = "saved";
    if (activeDraftRef.current.saveStatus === "sending") {
      saveStatus = "sending";
    } else if (haveComposeDraftPersistedFieldsChanged(draft, current)) {
      saveStatus = "idle";
    }
    setDraft({
      ...current,
      attachments,
      baseRevision: saved.baseRevision,
      draftId: saved.draftId,
      inlineImages,
      lastSavedAt: saved.lastSavedAt,
      messageId: saved.messageId,
      saveStatus,
    });
    recovery.checkpoint();
    void (async () => {
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
    })();
    return true;
  };

  const persistCurrentDraft = async (
    background = false,
    hydrateAttachments = false
  ): Promise<boolean> => {
    while (savingRef.current !== null) {
      await savingRef.current;
    }
    if (
      background &&
      (finishingRef.current ||
        draftClosedRef.current ||
        assistantUnsavedRef.current ||
        activeDraftRef.current.saveStatus === "sending" ||
        (activeDraftRef.current.saveStatus === "error" &&
          !retryableSaveErrorRef.current))
    ) {
      return true;
    }
    const saving = persistDraftSnapshot(hydrateAttachments);
    savingRef.current = saving;
    try {
      return await saving;
    } finally {
      savingRef.current = null;
    }
  };

  const prepareSenderSwitch = async (
    sourceUnavailable = false
  ): Promise<{
    currentDraft: ComposeDraftState;
    transferDraft: ComposeDraftState;
  } | null> => {
    if (
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "saving" ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return null;
    }
    const hasProviderAttachments = [
      ...activeDraftRef.current.attachments,
      ...activeDraftRef.current.inlineImages,
    ].some((asset) => asset.gmailAttachmentId !== undefined);
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      if (
        !sourceUnavailable &&
        !(await persistCurrentDraft(false, hasProviderAttachments))
      ) {
        return null;
      }
      const current = buildDraftFromForm(form.state.values);
      const copied = cloneComposeDraftRuntimeFiles(current);
      const fresh = createEmptyComposeDraft();
      senderSourceUnavailableRef.current = sourceUnavailable;
      recovery.checkpoint();
      return {
        currentDraft: current,
        transferDraft: {
          ...fresh,
          attachments: copied.attachments,
          bodyHtml: copied.bodyHtml,
          bodyText: current.bodyText,
          errorMessage: current.errorMessage,
          inlineImages: copied.inlineImages,
          recipients: { ...current.recipients },
          recoveryMissingFiles: current.recoveryMissingFiles,
          sendOperationId: crypto.randomUUID(),
          subject: current.subject,
        },
      };
    } catch (error) {
      toastError(error, {
        boundary: "compose-change-sender",
        fallback:
          "Some draft files could not be prepared. Reattach them before changing the sending address.",
      });
      return null;
    } finally {
      finishingRef.current = false;
      setState((current) => ({ ...current, isFinishing: false }));
    }
  };

  useDraftAutosave({
    attachments: state.draft.attachments,
    enabled: persistDrafts && !autosavePaused && state.open,
    mailboxId,
    save: async () => {
      if (
        !assistantUnsavedRef.current &&
        !draftClosedRef.current &&
        !finishingRef.current &&
        activeDraftRef.current.saveStatus !== "sending" &&
        (activeDraftRef.current.saveStatus !== "error" ||
          retryableSaveErrorRef.current) &&
        composeDraftFormValuesSchema.safeParse(form.state.values).success
      ) {
        return await persistCurrentDraft(true);
      }
      return true;
    },
    subscribe: (onChange) => form.store.subscribe(onChange),
  });

  useBlocker({
    enableBeforeUnload: () => {
      if (
        !draftClosedRef.current &&
        (activeDraftRef.current.saveStatus === "sending" ||
          finishingRef.current)
      ) {
        return true;
      }
      const { values } = form.state;
      const draft = buildDraftFromForm(values);
      return (
        !draftClosedRef.current &&
        (hasComposeDraftContent(draft) ||
          !!draft.draftId ||
          needsSaveRef.current) &&
        (!composeDraftFormValuesSchema.safeParse(values).success ||
          needsSaveRef.current ||
          shouldPersistComposeDraft({
            currentDraft: {
              ...lastSavedDraftRef.current,
              saveStatus: recoveredChangesRef.current
                ? "error"
                : activeDraftRef.current.saveStatus,
            },
            nextDraft: draft,
            values,
          }))
      );
    },
    shouldBlockFn: async ({ current: currentLocation, next: nextLocation }) => {
      const nextSearch = nextLocation.search;
      if (
        senderRouteMailboxIdRef.current !== null &&
        typeof nextSearch === "object" &&
        nextSearch !== null &&
        "mailbox" in nextSearch &&
        nextSearch.mailbox === "compose" &&
        "mailboxId" in nextSearch &&
        nextSearch.mailboxId === senderRouteMailboxIdRef.current
      ) {
        senderRouteMailboxIdRef.current = null;
        navigationCleanupRef.current = false;
        return false;
      }
      if (draftClosedRef.current) {
        return false;
      }
      if (
        currentLocation.pathname === nextLocation.pathname &&
        ["mailboxId", "mailbox", "messageId", "threadId", "view"].every(
          (field) =>
            Reflect.get(currentLocation.search, field) ===
            Reflect.get(nextLocation.search, field)
        )
      ) {
        navigationCleanupRef.current = false;
        return false;
      }
      if (
        activeDraftRef.current.saveStatus === "sending" ||
        finishingRef.current
      ) {
        return true;
      }
      finishingRef.current = true;
      setState((current) => ({ ...current, isFinishing: true }));
      try {
        if (activeDraftRef.current.sendUncertain === true) {
          navigationCleanupRef.current = false;
          recovery.checkpoint();
          return false;
        }
        if (!(await persistCurrentDraft())) {
          return true;
        }
        navigationCleanupRef.current = true;
        return false;
      } finally {
        finishingRef.current = false;
        setState((current) => ({ ...current, isFinishing: false }));
      }
    },
  });

  const handleUserDraftChange = () => {
    assistantUnsavedRef.current = false;
    saveErrorReportedRef.current = false;
    setDraft((current) => ({
      ...current,
      errorMessage: null,
      saveStatus:
        current.saveStatus === "saving" || current.saveStatus === "sending"
          ? current.saveStatus
          : "idle",
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
      finishingRef.current
    ) {
      return;
    }
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      if (activeDraftRef.current.sendUncertain === true) {
        closeDialog(afterClose, true);
        return;
      }
      if (!(await persistCurrentDraft())) {
        return;
      }
      clearComposeDraftRuntimeFiles(activeDraftRef.current);
      closeDialog(afterClose);
    } finally {
      finishingRef.current = false;
      setState((current) => ({ ...current, isFinishing: false }));
    }
  };

  const saveDraftCopy = async () => {
    if (
      !saveConflictRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending" ||
      finishingRef.current
    ) {
      return;
    }
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      await savingRef.current;
      const original = activeDraftRef.current;
      saveConflictRef.current = false;
      setCanSaveDraftCopy(false);
      setDraft({
        ...original,
        attachments: original.attachments.map((asset) => ({
          ...asset,
          sourceMessageId: asset.sourceMessageId ?? original.messageId,
        })),
        baseRevision: undefined,
        draftId: undefined,
        errorMessage: null,
        inlineImages: original.inlineImages.map((asset) => ({
          ...asset,
          sourceMessageId: asset.sourceMessageId ?? original.messageId,
        })),
        lastSavedAt: undefined,
        localId: crypto.randomUUID(),
        messageId: undefined,
        saveStatus: "idle",
        sendOperationId: crypto.randomUUID(),
      });
      lastSavedDraftRef.current = activeDraftRef.current;
      if (await persistCurrentDraft()) {
        await recovery.complete(original);
        closeDialog();
      }
    } finally {
      finishingRef.current = false;
      setState((current) => ({ ...current, isFinishing: false }));
    }
  };

  const checkSendDelivery = async () => {
    const draft = activeDraftRef.current;
    if (
      mailboxId === null ||
      mailboxId === "" ||
      draft.sendUncertain !== true ||
      finishingRef.current
    ) {
      return;
    }
    if (!draft.sendOperationId) {
      setDraft({
        ...draft,
        errorMessage:
          "This earlier send cannot be checked automatically. Check Sent before composing another message.",
        saveStatus: "error",
      });
      recovery.checkpoint();
      return;
    }
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      const delivery = await rpc.mail.getComposeSendStatus({
        mailboxId,
        sendOperationId: draft.sendOperationId,
      });
      if (delivery.status === "sent") {
        closeDialog();
        try {
          await Promise.all([
            refreshCachedMailboxQueries(queryClient, mailboxId, "drafts"),
            refreshCachedMailboxQueries(queryClient, mailboxId, "sent"),
            refreshThread(draft),
          ]);
        } catch (error) {
          toastError(error, {
            boundary: "compose-confirmed-send-refresh",
            fallback: "Message sent. Refresh to update your mailbox.",
          });
        }
      } else if (delivery.status === "rejected") {
        setDraft({
          ...activeDraftRef.current,
          errorMessage: null,
          saveStatus: "idle",
          sendUncertain: false,
        });
        try {
          const prepared = await prepareLoadedComposeDraft(
            mailboxId,
            buildDraftFromForm(form.state.values)
          );
          form.setFieldValue("bodyHtml", prepared.bodyHtml);
        } catch (error) {
          setDraft((current) => ({
            ...current,
            errorMessage:
              "Delivery failed. Some draft files could not be loaded. Reattach them before sending.",
            saveStatus: "error",
          }));
          toastError(error, { boundary: "compose-rejected-send-images" });
        }
        recovery.checkpoint();
      } else {
        setDraft({
          ...activeDraftRef.current,
          errorMessage:
            "Delivery is still being confirmed. Check Sent before sending again.",
          saveStatus: "error",
        });
        recovery.checkpoint();
      }
    } catch (error) {
      toastError(error, {
        boundary: "compose-check-delivery",
        fallback: "Could not check delivery. Please try again.",
      });
    } finally {
      finishingRef.current = false;
      setState((current) => ({ ...current, isFinishing: false }));
    }
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
      finishingRef.current
    ) {
      return;
    }
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    await savingRef.current;
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
      finishingRef.current = false;
      setState((current) => ({ ...current, isFinishing: false }));
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

  const changeComposeAction = async (next: ComposeActionDraft) => {
    if (!mountedRef.current || draftClosedRef.current) {
      return;
    }
    if (actionRunningRef.current) {
      queuedActionRef.current = next;
      return;
    }
    if (
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }
    finishingRef.current = true;
    actionRunningRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    let prepared: ComposeDraftState | null = null;
    try {
      await savingRef.current;
      const previous = previousActionRef.current;
      const quote = next.actionQuote;
      const replaceQuote =
        quote !== undefined &&
        (previous.sourceMessageId !== next.draftAnchor?.sourceMessageId ||
          (previous.seededBy === "forward") !==
            (next.draftAnchor?.seededBy === "forward"));
      if (replaceQuote && mailboxId) {
        prepared = {
          ...next,
          attachments: quote.attachments,
          ...prepareComposeActionQuote({
            inlineImages: activeDraftRef.current.inlineImages,
            quote,
            sameSource:
              previous.sourceMessageId === next.draftAnchor?.sourceMessageId,
          }),
        };
        if (!demoMode && !managedDemoMode) {
          prepared = await prepareLoadedComposeDraft(mailboxId, prepared);
        }
      }
      if (
        !mountedRef.current ||
        draftClosedRef.current ||
        Object.is(activeDraftRef.current.sendUncertain, true) ||
        queuedActionRef.current
      ) {
        return;
      }
      handleUserDraftChange();
      draftRevisionRef.current += 1;
      const { current } = activeDraftRef;
      let { bodyHtml } = form.state.values;
      let { attachments } = current;
      let { inlineImages } = current;
      if (prepared && quote) {
        let previousHtml = previous.html;
        if (
          previous.sourceMessageId === next.draftAnchor?.sourceMessageId &&
          !previous.html.includes("data-compose-quote")
        ) {
          previousHtml =
            previous.seededBy === "forward"
              ? quote.forwardHtml
              : quote.replyHtml;
        }
        bodyHtml = replaceComposeActionQuote({
          currentHtml: normalizeHtml(bodyHtml),
          inlineImages: [
            ...previous.inlineImages,
            ...current.inlineImages,
            ...prepared.inlineImages,
          ],
          nextHtml: normalizeHtml(prepared.bodyHtml),
          previousHtml: normalizeHtml(previousHtml),
        });
        attachments = [
          ...current.attachments.filter(
            (asset) =>
              !previous.attachments.some(
                (generated) => generated.id === asset.id
              )
          ),
          ...prepared.attachments,
        ];
        inlineImages = getReferencedComposeActionImages(bodyHtml, [
          ...current.inlineImages,
          ...prepared.inlineImages.filter(
            (asset) =>
              !current.inlineImages.some((existing) => existing.id === asset.id)
          ),
        ]);
        previousActionRef.current = {
          attachments: prepared.attachments,
          html: prepared.bodyHtml,
          inlineImages: prepared.inlineImages,
          seededBy: next.draftAnchor?.seededBy,
          sourceMessageId: next.draftAnchor?.sourceMessageId,
        };
      }
      setDraft({
        ...current,
        attachments,
        bodyHtml,
        bodyText: prepared
          ? getTextFromHtml(bodyHtml)
          : form.state.values.bodyText,
        draftAnchor: next.draftAnchor,
        inlineImages,
        replyContext: next.replyContext,
        updatedAt: Date.now(),
      });
      form.setFieldValue("to", next.recipients.to);
      form.setFieldValue("cc", next.recipients.cc);
      form.setFieldValue("bcc", next.recipients.bcc);
      form.setFieldValue("subject", next.subject);
      if (prepared) {
        form.setFieldValue("bodyHtml", bodyHtml);
        form.setFieldValue("bodyText", getTextFromHtml(bodyHtml));
      }
      setState((value) => ({
        ...value,
        showBcc: next.recipients.bcc.trim() !== "",
        showCc: next.recipients.cc.trim() !== "",
      }));
      recovery.checkpoint();
    } catch (error) {
      if (!queuedActionRef.current) {
        toastError(error, {
          boundary: "compose-change-action",
          fallback:
            "Could not prepare this reply or forward. Please try again.",
        });
      }
    } finally {
      if (prepared) {
        const owned = runtimeDraftRef.current;
        const ownedIds = new Set(
          [...owned.attachments, ...owned.inlineImages].map((asset) => asset.id)
        );
        clearComposeDraftRuntimeFiles({
          ...prepared,
          attachments: prepared.attachments.filter(
            (asset) => !ownedIds.has(asset.id)
          ),
          inlineImages: prepared.inlineImages.filter(
            (asset) => !ownedIds.has(asset.id)
          ),
        });
      }
      finishingRef.current = false;
      actionRunningRef.current = false;
      setState((value) => ({ ...value, isFinishing: false }));
      const queued = queuedActionRef.current;
      queuedActionRef.current = null;
      if (queued && mountedRef.current) {
        void changeComposeAction(queued);
      }
    }
  };

  const addInlineImageFiles = (files: File[]) => {
    if (
      files.length === 0 ||
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }

    try {
      handleUserDraftChange();
      const inlineImages = createComposeInlineImagesFromFiles(files);
      const nextDraft = {
        ...activeDraftRef.current,
        bodyHtml: form.state.values.bodyHtml,
        bodyText: form.state.values.bodyText,
        errorMessage: null,
        inlineImages: [...activeDraftRef.current.inlineImages, ...inlineImages],
        recoveryMissingFiles:
          activeDraftRef.current.recoveryMissingFiles?.filter(
            (name) => !files.some((file) => file.name === name)
          ),
        saveStatus: activeDraftRef.current.saveStatus,
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

  const addAttachmentFiles = (files: File[]) => {
    if (
      files.length === 0 ||
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }
    try {
      const draft = addComposeAttachmentFiles(activeDraftRef.current, files);
      draftRevisionRef.current += 1;
      handleUserDraftChange();
      setDraft({
        ...draft,
        errorMessage: null,
        recoveryMissingFiles: draft.recoveryMissingFiles?.filter(
          (name) => !files.some((file) => file.name === name)
        ),
        saveStatus: activeDraftRef.current.saveStatus,
      });
      recovery.checkpoint();
    } catch (error) {
      toastError(error, {
        boundary: "compose-attachments",
        fallback:
          "Could not attach those files. Keep attachments under 24 MB and try again.",
      });
    }
  };

  const removeAttachment = (id: string) => {
    if (
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }
    handleUserDraftChange();
    draftRevisionRef.current += 1;
    removeComposeRuntimeFile(id);
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.filter(
        (attachment) => attachment.id !== id
      ),
      updatedAt: Date.now(),
    }));
    recovery.checkpoint();
  };

  return {
    addAttachmentFiles,
    addInlineImageFiles,
    allowSenderRouteChange: (nextMailboxId: string) => {
      senderRouteMailboxIdRef.current = nextMailboxId;
    },
    canSaveDraftCopy: canSaveDraftCopy && state.draft.sendUncertain !== true,
    changeComposeAction,
    checkSendDelivery,
    clearSenderRouteChange: () => {
      senderRouteMailboxIdRef.current = null;
    },
    closeComposeDialog,
    completeSenderSwitch: async () => {
      if (senderSourceUnavailableRef.current) {
        recovery.checkpoint();
      } else {
        await recovery.complete(activeDraftRef.current);
      }
      clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
    },
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    handleUserDraftChange,
    prepareSenderSwitch,
    removeAttachment,
    saveDraftCopy,
    setActiveDraftError,
    state,
    toggleRecipientVisibility,
  };
};

export type ComposeDialogController = ReturnType<
  typeof useComposeDialogController
>;
