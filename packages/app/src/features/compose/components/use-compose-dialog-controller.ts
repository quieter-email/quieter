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
  writeComposeFormValues,
} from "@quieter/app/features/compose/domain/compose-form";
import type { ComposeFormValues } from "@quieter/app/features/compose/domain/compose-form";
import {
  attachInlineImagesToHtml,
  addComposeAttachmentFiles,
  addComposeMessageAttachment,
  appendComposeSignature,
  clearComposeDraftRuntimeFiles,
  cloneComposeDraft,
  cloneComposeDraftRuntimeFiles,
  createComposeInlineImagesFromFiles,
  createEmptyComposeDraft,
  createRecoveredComposeCopy,
  deleteComposeDraft,
  removeComposeRuntimeFile,
  hasComposeDraftContent,
  haveComposeDraftPersistedFieldsChanged,
  prepareLoadedComposeDraft,
  saveComposeDraft,
  scheduleComposeMessage,
  sendComposeMessage,
  textToComposeBodyHtml,
} from "@quieter/app/features/compose/domain/draft";
import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { toastError } from "@quieter/app/lib/error-toast";
import {
  deleteDemoDraft,
  saveDemoDraft,
  sendDemoDraft,
} from "@quieter/app/lib/gmail/demo-mail";
import type { MessageAttachment } from "@quieter/app/lib/mail";
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
import { orpc, rpc } from "@quieter/app/lib/orpc";
import {
  isSuppressedRecipientError,
  shouldRetryOrpcError,
} from "@quieter/app/lib/orpc-errors";
import {
  composeDraftFormValuesSchema,
  composeSendFormValuesSchema,
} from "@quieter/mail/compose/schema";
import type { FollowUpReminderIntent } from "@quieter/mail/reminders";
import type { ScheduledSendTime } from "@quieter/mail/scheduled-send";
import type { RouterOutputs } from "@quieter/orpc";
import { toast } from "@quieter/ui/toast";
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { recoverComposeSchedule } from "../domain/scheduled-recovery";

type ComposeDraftUpdate =
  | ComposeDraftState
  | ((current: ComposeDraftState) => ComposeDraftState);

type ComposeBridge = NonNullable<
  ReturnType<NonNullable<ReturnType<typeof useAgentWorkspace>>["getCompose"]>
>;

type ComposeActionToken = {
  mailboxId: string | null;
  localId: string;
  sendOperationId: ComposeDraftState["sendOperationId"];
  draftRevision: number;
};

export type PreparedComposeSenderSwitch = {
  currentDraft: ComposeDraftState;
  transferDraft: ComposeDraftState;
  isCurrent: () => boolean;
  completeSenderSwitch: (commit: () => void) => Promise<boolean>;
  release: () => void;
};

export type ComposeHeldReceipt = Pick<
  NonNullable<RouterOutputs["mail"]["getHeldSend"]>,
  "sendOperationId" | "status" | "canUndo" | "undoUntil"
> & {
  mailboxId: string;
  draftId: string;
  draftRevision: number;
  restoredDraftId: string | null;
};

type HeldTask = {
  mailboxId: string;
  localId: string;
  sendOperationId: string;
  promise: Promise<HeldCompletionResult>;
};

type HeldCompletionResult =
  | { kind: "complete" }
  | { kind: "failed"; error: unknown };

type HeldCompletion =
  | { kind: "undo" }
  | { kind: "abandoned" }
  | { kind: "accepted" }
  | { kind: "canceled"; draftId: string | null };

const SUPPRESSED_RECIPIENT_MESSAGE =
  "This message includes a recipient that can no longer receive mail from this team.";

export const getDraftStatusMessage = (
  draft: ComposeDraftState,
  persistDrafts = true
) => {
  if (draft.saveStatus === "sending") {
    return draft.scheduleAttempt ? "Scheduling message…" : "Sending message…";
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
  if (draft.assistantUnsaved === true) {
    return "Unsaved changes";
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
  editorReady,
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
  editorReady: boolean;
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
    const draft = cloneComposeDraft(seed);
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
        sendUncertain: resolved.scheduleAttempt ? true : resolved.sendUncertain,
      },
      isFinishing: false,
      open: true,
      showBcc: resolved.recipients.bcc.trim() !== "",
      showCc: resolved.recipients.cc.trim() !== "",
    };
  });
  // oxlint-disable-next-line react/hook-use-state -- Later draft and action changes write the form explicitly.
  const [defaultValues] = useState(() => draftToComposeFormValues(state.draft));
  const needsSaveRef = useRef(initialDraftNeedsSave && persistDrafts);
  const activeDraftRef = useRef(state.draft);
  const runtimeDraftRef = useRef(state.draft);
  const lastSavedDraftRef = useRef(state.draft);
  const recoveredChangesRef = useRef(
    state.draft.recoveryEditorId !== undefined ||
      (state.draft.saveStatus === "idle" && !!state.draft.draftId)
  );
  const draftClosedRef = useRef(false);
  const mountedRef = useRef(false);
  const savingRef = useRef<Promise<boolean> | null>(null);
  const finishingRef = useRef(false);
  const finishingActionRef = useRef<ComposeActionToken | null>(null);
  const senderRouteMailboxIdRef = useRef<string | null>(null);
  const navigationCleanupRef = useRef(false);
  const senderSourceUnavailableRef = useRef(false);
  const draftRevisionRef = useRef(0);
  const restoredDraftRevisionRef = useRef(0);
  const retryableSaveErrorRef = useRef(false);
  const saveErrorReportedRef = useRef(false);
  const saveConflictRef = useRef(false);
  const scheduleRequestRef = useRef<ScheduledSendTime | null>(null);
  const heldTaskRef = useRef<HeldTask | null>(null);
  const currentMailboxIdRef = useRef(mailboxId);
  useLayoutEffect(() => {
    currentMailboxIdRef.current = mailboxId;
  }, [mailboxId]);
  const heldTerminalRef = useRef<{
    sendOperationId: string;
    completion: Exclude<HeldCompletion, { kind: "undo" }>;
  } | null>(null);
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

  const captureComposeAction = (): ComposeActionToken => {
    const draft = activeDraftRef.current;
    return {
      draftRevision: draftRevisionRef.current,
      localId: draft.localId,
      mailboxId,
      sendOperationId: draft.sendOperationId,
    };
  };

  const isCurrentComposeAction = (
    action: ComposeActionToken,
    {
      allowNewerEdits = false,
      allowUncertain = false,
    }: { allowNewerEdits?: boolean; allowUncertain?: boolean } = {}
  ) => {
    const draft = activeDraftRef.current;
    return (
      mountedRef.current &&
      !draftClosedRef.current &&
      currentMailboxIdRef.current === action.mailboxId &&
      draft.localId === action.localId &&
      draft.sendOperationId === action.sendOperationId &&
      (allowNewerEdits || draftRevisionRef.current === action.draftRevision) &&
      (allowUncertain || draft.sendUncertain !== true)
    );
  };

  const finishComposeAction = (action: ComposeActionToken) => {
    if (finishingActionRef.current !== action) {
      return;
    }
    finishingActionRef.current = null;
    finishingRef.current = false;
    if (mountedRef.current) {
      setState((current) => ({ ...current, isFinishing: false }));
    }
  };

  const buildDraftFromForm = (values: ComposeFormValues): ComposeDraftState => {
    const draft = activeDraftRef.current;

    return composeFormValuesToDraft(values, {
      assistantUnsaved: draft.assistantUnsaved,
      attachments: draft.attachments,
      baseRevision: draft.baseRevision,
      draftAnchor: draft.draftAnchor,
      draftId: draft.draftId,
      errorMessage: null,
      followUpReminder: draft.followUpReminder,
      heldDraftHasNewerEdits: draft.heldDraftHasNewerEdits,
      holdAttempt: draft.holdAttempt,
      inlineImages: draft.inlineImages,
      lastSavedAt: draft.lastSavedAt,
      localId: draft.localId,
      messageId: draft.messageId,
      recoveryEditorId: draft.recoveryEditorId,
      recoveryLocalId: draft.recoveryLocalId,
      recoveryMissingFiles: draft.recoveryMissingFiles,
      recoveryRevision: draft.recoveryRevision,
      recoveryUpdatedAt: draft.recoveryUpdatedAt,
      replyContext: draft.replyContext,
      saveStatus: "idle",
      scheduleAttempt: draft.scheduleAttempt,
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
    const scheduling = activeDraftRef.current.scheduleAttempt !== undefined;
    let errorMessage = scheduling
      ? "Could not schedule message. Please try again."
      : "Could not send message. Please try again.";
    if (deliveryUncertain) {
      errorMessage = scheduling
        ? "Scheduling could not be confirmed. Check the schedule before sending again."
        : "Delivery could not be confirmed. Check Sent before sending again.";
    } else if (isRecipientProblem) {
      errorMessage = SUPPRESSED_RECIPIENT_MESSAGE;
    } else if (saveConflictRef.current) {
      errorMessage =
        "This draft changed elsewhere. Save a copy to keep your changes.";
    }
    setDraft({
      ...activeDraftRef.current,
      errorMessage,
      holdAttempt: deliveryUncertain
        ? activeDraftRef.current.holdAttempt
        : undefined,
      saveStatus: "error",
      scheduleAttempt: deliveryUncertain
        ? activeDraftRef.current.scheduleAttempt
        : undefined,
      sendUncertain: deliveryUncertain,
    });
    toastError(error, {
      boundary: scheduling ? "compose-schedule" : "compose-send",
      fallback: scheduling
        ? "Could not schedule message. Please try again."
        : "Could not send message. Please try again.",
    });
    // oxlint-disable-next-line no-use-before-define -- The form invokes this handler after recovery initializes.
    recovery.checkpoint();
    if (isRecipientProblem) {
      onRecipientProblem?.();
    }
  };

  const completeScheduledMessage = async ({
    scheduled,
    message,
    scheduledMailboxId,
  }: {
    scheduled: Awaited<ReturnType<typeof rpc.scheduledSends.create>>;
    message: ComposeDraftState;
    scheduledMailboxId: string;
  }) => {
    closeDialog();
    if (scheduled.status === "failed") {
      toastError(
        {
          message:
            scheduled.errorMessage ??
            "Scheduling needs attention. Open Scheduled to review this message.",
          status: 400,
        },
        { boundary: "compose-schedule-preparation" }
      );
    } else if (scheduled.status === "preparing") {
      toast("Message saved in Scheduled. Scheduling is still being confirmed.");
    } else if (scheduled.status === "uncertain") {
      toast("Delivery is being confirmed. Check Scheduled or Sent.");
    } else if (scheduled.status === "sent") {
      toast.success("This message has been sent.");
    } else if (scheduled.status === "sending") {
      toast("This message is sending.");
    } else if (scheduled.status === "cancelled") {
      toast.success("This scheduled send was cancelled. Check Drafts.");
    } else {
      toast.success(
        `Scheduled for ${new Intl.DateTimeFormat(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: scheduled.timeZone,
        }).format(new Date(scheduled.sendAt))}.`
      );
    }
    await Promise.all([
      refreshCachedMailboxQueries(queryClient, scheduledMailboxId, "drafts"),
      queryClient.invalidateQueries({
        queryKey: orpc.scheduledSends.list.queryOptions({
          input: { mailboxId: scheduledMailboxId },
        }).queryKey,
      }),
    ]).catch((error: unknown) => {
      toastError(error, {
        boundary: "compose-scheduled-refresh",
        fallback: "Refresh to update your scheduled messages.",
      });
    });
    clearComposeDraftRuntimeFiles(message);
  };

  const submitComposeForm = async (
    values: ComposeFormValues,
    schedule: ScheduledSendTime | null
  ) => {
    if (activeDraftRef.current.sendUncertain === true) {
      // oxlint-disable-next-line no-use-before-define -- Submission runs after the delivery handler initializes.
      await checkSendDelivery();
      return;
    }
    if (
      mailboxId === null ||
      mailboxId === "" ||
      !mountedRef.current ||
      draftClosedRef.current ||
      finishingRef.current ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }

    setDraft((current) => ({
      ...current,
      assistantUnsaved: false,
      errorMessage: null,
      holdAttempt:
        !schedule && !demoMode && !managedDemoMode ? true : undefined,
      saveStatus: "sending",
      scheduleAttempt: schedule ?? undefined,
      sendOperationId: current.sendOperationId ?? crypto.randomUUID(),
    }));
    const action = captureComposeAction();
    await savingRef.current;
    const { current: waitingDraft } = activeDraftRef;
    if (!isCurrentComposeAction(action) || heldTaskRef.current !== null) {
      if (
        isCurrentComposeAction(action, { allowNewerEdits: true }) &&
        waitingDraft.saveStatus === "sending" &&
        heldTaskRef.current === null
      ) {
        setDraft((current) => ({
          ...current,
          holdAttempt: undefined,
          saveStatus: "idle",
          scheduleAttempt: undefined,
        }));
        // oxlint-disable-next-line no-use-before-define -- Submission runs after recovery initializes.
        recovery.checkpoint();
      }
      return;
    }
    const message = buildDraftFromForm(values);
    setDraft({ ...message, saveStatus: "sending" });
    // oxlint-disable-next-line no-use-before-define -- The form invokes this handler after recovery initializes.
    recovery.checkpoint();

    try {
      if (schedule) {
        const scheduled = await scheduleComposeMessage(
          mailboxId,
          message,
          schedule
        );
        if (!isCurrentComposeAction(action)) {
          if (isCurrentComposeAction(action, { allowNewerEdits: true })) {
            setDraft((draft) => ({
              ...draft,
              saveStatus: "idle",
              sendUncertain: true,
            }));
            // oxlint-disable-next-line no-use-before-define -- Submission runs after recovery initializes.
            recovery.checkpoint();
          }
          return;
        }
        await completeScheduledMessage({
          message,
          scheduled,
          scheduledMailboxId: mailboxId,
        });
        return;
      }
      if (demoMode) {
        sendDemoDraft(message);
      } else if (managedDemoMode) {
        sendManagedDemoDraft(message);
      } else {
        const held = await sendComposeMessage(mailboxId, message);
        queryClient.setQueryData(
          orpc.mail.getHeldSend.queryOptions({
            input: { mailboxId, sendOperationId: held.sendOperationId },
          }).queryKey,
          held
        );
        // oxlint-disable-next-line no-use-before-define -- Submission runs after the held receipt handler initializes.
        await receiveHeldReceipt({
          ...held,
          draftId: action.localId,
          draftRevision: action.draftRevision,
          mailboxId,
          restoredDraftId: held.status === "canceled" ? held.draftId : null,
        });
        return;
      }
    } catch (error) {
      if (isCurrentComposeAction(action, { allowNewerEdits: true })) {
        handleSendFailure(error);
      }
      return;
    }

    closeDialog();

    if (message.draftId !== undefined && message.draftId !== "") {
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
      await submitComposeForm(value, scheduleRequestRef.current);
    },
    validationLogic: revalidateLogic(),
    validators: {
      onDynamic: composeDraftFormValuesSchema,
      onSubmit: composeSendFormValuesSchema,
    },
  });

  const handleScheduleMessage = async (schedule: ScheduledSendTime) => {
    if (demoMode || managedDemoMode || scheduleRequestRef.current !== null) {
      return;
    }
    scheduleRequestRef.current = schedule;
    try {
      await form.handleSubmit();
    } finally {
      scheduleRequestRef.current = null;
    }
  };

  const recovery = useDraftRecovery({
    enabled: persistDrafts && !demoMode && !managedDemoMode && state.open,
    getDraft: () => ({
      ...buildDraftFromForm(form.state.values),
      errorMessage: activeDraftRef.current.errorMessage,
      saveStatus: activeDraftRef.current.saveStatus,
    }),
    mailboxId,
    queryClient,
    subscribe: (onChange) => form.store.subscribe(onChange),
  });
  const checkpointRecovery = useEffectEvent(() => {
    recovery.checkpoint();
  });

  const releaseUnmountedDraft = useEffectEvent(async () => {
    const draft = buildDraftFromForm(form.state.values);
    clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
    if (
      !draftClosedRef.current &&
      !needsSaveRef.current &&
      !senderSourceUnavailableRef.current &&
      activeDraftRef.current.assistantUnsaved !== true &&
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
      receipt: Parameters<ComposeBridge["applyReceipt"]>[0],
      matchesRevision: boolean
    ) => {
      if (
        receipt.draftId !== activeDraftRef.current.localId ||
        receipt.draftRevision < restoredDraftRevisionRef.current
      ) {
        return;
      }
      if (receipt.status === "sent") {
        draftClosedRef.current = true;
        void recovery.complete(activeDraftRef.current);
        clearComposeDraftRuntimeFiles(runtimeDraftRef.current);
        setState((currentState) => ({ ...currentState, open: false }));
        onClose?.();
      } else {
        const draft = {
          ...activeDraftRef.current,
          assistantUnsaved: matchesRevision
            ? false
            : activeDraftRef.current.assistantUnsaved,
          attachments: activeDraftRef.current.attachments.map((asset) => {
            const saved = receipt.attachments?.find(
              (candidate) => candidate.id === asset.id
            );
            return saved
              ? { ...saved, name: matchesRevision ? saved.name : asset.name }
              : asset;
          }),
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

  const persistDraftSnapshot = async (
    hydrateAttachments = false,
    authorizeProposal = false
  ) => {
    const { values } = form.state;
    const draft = buildDraftFromForm(values);
    const action = captureComposeAction();
    const savedRevision = draftRevisionRef.current;
    if (
      draft.sendUncertain === true ||
      (draft.assistantUnsaved === true && !authorizeProposal)
    ) {
      recovery.checkpoint();
      return true;
    }
    if (
      persistDrafts &&
      hasComposeDraftContent(draft) &&
      !composeDraftFormValuesSchema.safeParse(values).success
    ) {
      await form.validateAllFields("change");
      if (!isCurrentComposeAction(action)) {
        return false;
      }
      setDraft({
        ...draft,
        errorMessage: "Check the recipient addresses before saving your draft.",
        saveStatus: "error",
      });
      return false;
    }
    if (mailboxId === null || mailboxId === "" || !persistDrafts) {
      return true;
    }
    if (
      !needsSaveRef.current &&
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
      })
    ) {
      if (
        authorizeProposal &&
        draft.assistantUnsaved === true &&
        draft.draftId
      ) {
        setDraft({ ...draft, assistantUnsaved: false, saveStatus: "saved" });
        recovery.checkpoint();
      }
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
      if (!isCurrentComposeAction(action, { allowNewerEdits: true })) {
        return false;
      }
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
    const current = buildDraftFromForm(form.state.values);
    if (!isCurrentComposeAction(action, { allowNewerEdits: true })) {
      return false;
    }
    lastSavedDraftRef.current = saved;
    needsSaveRef.current = false;
    recoveredChangesRef.current = false;
    retryableSaveErrorRef.current = false;
    saveErrorReportedRef.current = false;
    saveConflictRef.current = false;
    setCanSaveDraftCopy(false);
    const attachments = activeDraftRef.current.attachments.map((attachment) => {
      const savedAttachment = saved.attachments.find(
        (asset) => asset.id === attachment.id
      );
      return savedAttachment
        ? { ...savedAttachment, name: attachment.name }
        : attachment;
    });
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
      assistantUnsaved:
        authorizeProposal && savedRevision === draftRevisionRef.current
          ? false
          : current.assistantUnsaved,
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
    hydrateAttachments = false,
    authorizeProposal = false
  ): Promise<boolean> => {
    const action = captureComposeAction();
    while (savingRef.current !== null) {
      await savingRef.current;
      if (
        !isCurrentComposeAction(action) ||
        (activeDraftRef.current.assistantUnsaved === true && !authorizeProposal)
      ) {
        return false;
      }
    }
    if (
      background &&
      (finishingRef.current ||
        draftClosedRef.current ||
        activeDraftRef.current.assistantUnsaved === true ||
        activeDraftRef.current.sendUncertain === true ||
        activeDraftRef.current.saveStatus === "sending" ||
        (activeDraftRef.current.saveStatus === "error" &&
          !retryableSaveErrorRef.current))
    ) {
      return true;
    }
    const saving = persistDraftSnapshot(hydrateAttachments, authorizeProposal);
    savingRef.current = saving;
    try {
      return await saving;
    } finally {
      savingRef.current = null;
    }
  };

  const prepareSenderSwitch = async (
    sourceUnavailable = false
  ): Promise<PreparedComposeSenderSwitch | null> => {
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
    const action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    let prepared = false;
    try {
      if (
        !sourceUnavailable &&
        activeDraftRef.current.assistantUnsaved !== true &&
        !(await persistCurrentDraft(false, hasProviderAttachments))
      ) {
        return null;
      }
      let current = buildDraftFromForm(form.state.values);
      if (!isCurrentComposeAction(action)) {
        return null;
      }
      if (
        current.assistantUnsaved === true &&
        hasProviderAttachments &&
        mailboxId &&
        !sourceUnavailable
      ) {
        current = await prepareLoadedComposeDraft(mailboxId, current);
        if (!isCurrentComposeAction(action)) {
          return null;
        }
      }
      const copied = cloneComposeDraftRuntimeFiles(current);
      const fresh = createEmptyComposeDraft();
      senderSourceUnavailableRef.current = sourceUnavailable;
      recovery.checkpoint();
      const runtime = runtimeDraftRef.current;
      const isCurrent = () =>
        finishingActionRef.current === action && isCurrentComposeAction(action);
      prepared = true;
      return {
        completeSenderSwitch: async (commit) => {
          if (!isCurrent()) {
            return false;
          }
          if (sourceUnavailable || current.assistantUnsaved === true) {
            recovery.checkpoint();
          } else {
            await recovery.complete(current, isCurrent);
          }
          if (!isCurrent()) {
            recovery.checkpoint();
            return false;
          }
          commit();
          draftClosedRef.current = true;
          clearComposeDraftRuntimeFiles(runtime);
          return true;
        },
        currentDraft: current,
        isCurrent,
        release: () => {
          finishComposeAction(action);
        },
        transferDraft: {
          ...fresh,
          assistantUnsaved: current.assistantUnsaved,
          attachments: copied.attachments,
          bodyHtml: copied.bodyHtml,
          bodyText: current.bodyText,
          errorMessage: current.errorMessage,
          followUpReminder: current.followUpReminder,
          inlineImages: copied.inlineImages,
          recipients: { ...current.recipients },
          recoveryMissingFiles: current.recoveryMissingFiles,
          sendOperationId: crypto.randomUUID(),
          subject: current.subject,
        },
      };
    } catch (error) {
      if (isCurrentComposeAction(action)) {
        toastError(error, {
          boundary: "compose-change-sender",
          fallback:
            "Some draft files could not be prepared. Reattach them before changing the sending address.",
        });
      }
      return null;
    } finally {
      if (!prepared) {
        finishComposeAction(action);
      }
    }
  };

  useDraftAutosave({
    attachments: state.draft.attachments,
    enabled:
      persistDrafts &&
      !autosavePaused &&
      state.open &&
      state.draft.sendUncertain !== true,
    followUpReminder: state.draft.followUpReminder,
    mailboxId,
    save: async () => {
      if (
        activeDraftRef.current.assistantUnsaved !== true &&
        !draftClosedRef.current &&
        !finishingRef.current &&
        activeDraftRef.current.sendUncertain !== true &&
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
      const action = captureComposeAction();
      finishingActionRef.current = action;
      finishingRef.current = true;
      setState((current) => ({ ...current, isFinishing: true }));
      try {
        if (
          activeDraftRef.current.sendUncertain === true ||
          activeDraftRef.current.assistantUnsaved === true
        ) {
          navigationCleanupRef.current = false;
          recovery.checkpoint();
          return false;
        }
        const persisted = await persistCurrentDraft();
        const draft = activeDraftRef.current;
        if (
          !isCurrentComposeAction(action) ||
          draft.assistantUnsaved === true ||
          !persisted
        ) {
          if (finishingActionRef.current === action) {
            navigationCleanupRef.current = false;
          }
          if (
            isCurrentComposeAction(action, {
              allowNewerEdits: true,
              allowUncertain: true,
            })
          ) {
            recovery.checkpoint();
          }
          return true;
        }
        navigationCleanupRef.current = true;
        return false;
      } finally {
        finishComposeAction(action);
      }
    },
  });

  const handleUserDraftChange = () => {
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
    const action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      if (
        activeDraftRef.current.sendUncertain === true ||
        activeDraftRef.current.assistantUnsaved === true
      ) {
        closeDialog(afterClose, true);
        return;
      }
      const persisted = await persistCurrentDraft();
      const draft = activeDraftRef.current;
      if (
        !isCurrentComposeAction(action) ||
        draft.assistantUnsaved === true ||
        !persisted
      ) {
        if (
          isCurrentComposeAction(action, {
            allowNewerEdits: true,
            allowUncertain: true,
          })
        ) {
          recovery.checkpoint();
        }
        return;
      }
      clearComposeDraftRuntimeFiles(activeDraftRef.current);
      closeDialog(afterClose);
    } finally {
      finishComposeAction(action);
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
    let action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      await savingRef.current;
      if (!isCurrentComposeAction(action)) {
        return;
      }
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
        followUpReminder: original.followUpReminder
          ? { ...original.followUpReminder, requestId: crypto.randomUUID() }
          : original.followUpReminder,
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
      action = captureComposeAction();
      finishingActionRef.current = action;
      if (
        (await persistCurrentDraft(false, false, true)) &&
        isCurrentComposeAction(action) &&
        activeDraftRef.current.assistantUnsaved !== true
      ) {
        await recovery.complete(
          original,
          () =>
            isCurrentComposeAction(action) &&
            activeDraftRef.current.assistantUnsaved !== true
        );
        if (
          !isCurrentComposeAction(action) ||
          Object.is(activeDraftRef.current.assistantUnsaved, true)
        ) {
          return;
        }
        closeDialog();
      }
    } finally {
      finishComposeAction(action);
    }
  };

  const isCurrentHeldTask = (task: HeldTask) =>
    mountedRef.current &&
    !draftClosedRef.current &&
    currentMailboxIdRef.current === task.mailboxId &&
    heldTaskRef.current === task &&
    activeDraftRef.current.localId === task.localId &&
    activeDraftRef.current.sendOperationId === task.sendOperationId;

  const finishHeldOperation = async (
    completion: HeldCompletion
  ): Promise<HeldCompletionResult> => {
    const draft = cloneComposeDraft(buildDraftFromForm(form.state.values));
    if (
      !mountedRef.current ||
      draftClosedRef.current ||
      !mailboxId ||
      !draft.sendOperationId ||
      draft.holdAttempt !== true
    ) {
      return { kind: "complete" };
    }
    const existing = heldTaskRef.current;
    if (
      existing?.mailboxId === mailboxId &&
      existing.localId === draft.localId &&
      existing.sendOperationId === draft.sendOperationId
    ) {
      return await existing.promise;
    }
    finishingActionRef.current = null;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    const task: HeldTask = {
      localId: draft.localId,
      mailboxId,
      promise: Promise.resolve({ kind: "complete" }),
      sendOperationId: draft.sendOperationId,
    };
    heldTaskRef.current = task;
    task.promise = (async (): Promise<HeldCompletionResult> => {
      let prepared: ComposeDraftState | undefined;
      let restoringDraft: ComposeDraftState | undefined;
      try {
        const previousTerminal =
          heldTerminalRef.current?.sendOperationId === task.sendOperationId
            ? heldTerminalRef.current.completion
            : undefined;
        let terminal =
          previousTerminal?.kind === "canceled" &&
          previousTerminal.draftId === null &&
          (completion.kind === "undo" || completion.kind === "canceled")
            ? completion
            : (previousTerminal ?? completion);
        if (terminal.kind === "undo") {
          const canceled = await rpc.mail.undoSend({
            mailboxId: task.mailboxId,
            sendOperationId: task.sendOperationId,
          });
          if (!isCurrentHeldTask(task)) {
            return { kind: "complete" };
          }
          terminal =
            canceled.status === "abandoned"
              ? { kind: "abandoned" }
              : { draftId: canceled.draftId, kind: "canceled" };
        }
        heldTerminalRef.current = {
          completion: terminal,
          sendOperationId: task.sendOperationId,
        };
        if (
          terminal.kind !== "abandoned" &&
          draft.heldDraftHasNewerEdits === true
        ) {
          const copy = createRecoveredComposeCopy({
            ...draft,
            errorMessage: null,
            heldDraftHasNewerEdits: undefined,
            holdAttempt: undefined,
            scheduleAttempt: undefined,
            sendUncertain: false,
          });
          const localId = `held-edits-${task.sendOperationId}`;
          await recovery.preserveCopy(
            {
              ...copy,
              assistantUnsaved: true,
              recoveryEditorId: undefined,
              recoveryLocalId: localId,
              recoveryRevision: undefined,
              recoveryUpdatedAt: undefined,
            },
            { editorId: localId, localId }
          );
          if (!isCurrentHeldTask(task)) {
            return { kind: "complete" };
          }
        }
        if (terminal.kind === "accepted") {
          await recovery.complete(draft, () => isCurrentHeldTask(task));
          if (!isCurrentHeldTask(task)) {
            return { kind: "complete" };
          }
          closeDialog();
          toast.success(
            draft.heldDraftHasNewerEdits === true
              ? "Message sent. Your newer edits are recoverable after closing the composer."
              : "Message sent."
          );
          await Promise.all([
            refreshCachedMailboxQueries(queryClient, task.mailboxId, "drafts"),
            refreshCachedMailboxQueries(queryClient, task.mailboxId, "sent"),
            refreshThread(draft),
          ]).catch((error: unknown) => {
            toastError(error, { boundary: "compose-confirmed-send-refresh" });
          });
          return { kind: "complete" };
        }
        let restored: ComposeDraftState;
        if (terminal.kind === "abandoned") {
          restored = {
            ...draft,
            heldDraftHasNewerEdits: undefined,
            holdAttempt: undefined,
            saveStatus: "idle",
            scheduleAttempt: undefined,
          };
        } else {
          if (!terminal.draftId) {
            throw new Error(
              "Your restored draft is not available yet. Check delivery again."
            );
          }
          const canonical = await rpc.mail.getDraft({
            draftId: terminal.draftId,
            mailboxId: task.mailboxId,
          });
          if (!isCurrentHeldTask(task)) {
            return { kind: "complete" };
          }
          restored = {
            ...createEmptyComposeDraft(),
            ...canonical,
            draftAnchor: canonical.draftAnchor ?? null,
            messageId: canonical.messageId ?? undefined,
            saveStatus: "saved",
          };
        }
        restoringDraft = {
          ...restored,
          errorMessage: null,
          localId: task.localId,
          sendOperationId: crypto.randomUUID(),
          sendUncertain: false,
        };
        prepared = await prepareLoadedComposeDraft(
          task.mailboxId,
          restoringDraft
        );
        if (!isCurrentHeldTask(task)) {
          return { kind: "complete" };
        }
        setDraft(prepared);
        const editable = prepared;
        if (terminal.kind !== "abandoned") {
          lastSavedDraftRef.current = prepared;
          needsSaveRef.current = false;
          recoveredChangesRef.current = false;
        }
        draftRevisionRef.current += 1;
        restoredDraftRevisionRef.current = draftRevisionRef.current;
        writeComposeFormValues(form, draftToComposeFormValues(prepared));
        setState((current) => ({
          ...current,
          showBcc: editable.recipients.bcc.trim() !== "",
          showCc: editable.recipients.cc.trim() !== "",
        }));
        recovery.checkpoint();
        if (
          terminal.kind !== "abandoned" &&
          draft.heldDraftHasNewerEdits === true
        ) {
          toast("Your newer edits are recoverable after closing the composer.");
        }
        await refreshCachedMailboxQueries(
          queryClient,
          task.mailboxId,
          "drafts"
        ).catch((error: unknown) => {
          toastError(error, { boundary: "compose-restored-draft-refresh" });
        });
        return { kind: "complete" };
      } catch (error) {
        if (isCurrentHeldTask(task)) {
          setDraft((current) => ({
            ...current,
            errorMessage:
              "Could not finish updating this draft. Check delivery to try again.",
            saveStatus: "error",
          }));
          recovery.checkpoint();
          toastError(error, { boundary: "compose-held-send" });
        }
        return { error, kind: "failed" };
      } finally {
        const loaded = prepared ?? restoringDraft;
        if (loaded) {
          const ownedIds = new Set(
            [
              ...runtimeDraftRef.current.attachments,
              ...runtimeDraftRef.current.inlineImages,
            ].map((asset) => asset.id)
          );
          clearComposeDraftRuntimeFiles({
            ...loaded,
            attachments: loaded.attachments.filter(
              (asset) => !ownedIds.has(asset.id)
            ),
            inlineImages: loaded.inlineImages.filter(
              (asset) => !ownedIds.has(asset.id)
            ),
          });
        }
        if (heldTaskRef.current === task) {
          heldTaskRef.current = null;
          finishingRef.current = false;
          if (mountedRef.current) {
            setState((current) => ({ ...current, isFinishing: false }));
          }
        }
      }
    })();
    return await task.promise;
  };

  const receiveHeldReceipt = async (receipt: ComposeHeldReceipt) => {
    const { current } = activeDraftRef;
    if (
      !mountedRef.current ||
      draftClosedRef.current ||
      currentMailboxIdRef.current !== receipt.mailboxId ||
      current.localId !== receipt.draftId ||
      current.sendOperationId !== receipt.sendOperationId
    ) {
      return;
    }
    if (heldTaskRef.current !== null) {
      if (receipt.status === "accepted" || receipt.status === "canceled") {
        const result = await heldTaskRef.current.promise;
        if (result.kind === "failed") {
          throw result.error;
        }
      }
      return;
    }
    if (
      heldTerminalRef.current?.sendOperationId === receipt.sendOperationId &&
      receipt.status !== "accepted" &&
      receipt.status !== "canceled"
    ) {
      return;
    }
    const snapshot = cloneComposeDraft(buildDraftFromForm(form.state.values));
    setDraft({
      ...snapshot,
      heldDraftHasNewerEdits:
        current.heldDraftHasNewerEdits === true ||
        draftRevisionRef.current !== receipt.draftRevision,
      holdAttempt: true,
      saveStatus: "idle",
      sendUncertain: true,
    });
    recovery.retainHeldDraft();
    void queryClient.invalidateQueries({
      queryKey: orpc.mail.getHeldSend.queryOptions({
        input: {
          mailboxId: receipt.mailboxId,
          sendOperationId: receipt.sendOperationId,
        },
      }).queryKey,
    });
    if (receipt.status === "accepted" || receipt.status === "canceled") {
      const result = await finishHeldOperation(
        receipt.status === "accepted"
          ? { kind: "accepted" }
          : { draftId: receipt.restoredDraftId, kind: "canceled" }
      );
      if (result.kind === "failed") {
        throw result.error;
      }
    }
  };
  const applyHeldReceipt = useEffectEvent(receiveHeldReceipt);

  const restoreHeldMessage = async () => {
    await finishHeldOperation({ kind: "undo" });
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
    const action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    try {
      if (draft.holdAttempt === true) {
        const held = await rpc.mail.getHeldSend({
          mailboxId,
          sendOperationId: draft.sendOperationId,
        });
        if (!isCurrentComposeAction(action, { allowUncertain: true })) {
          return;
        }
        if (held !== null) {
          queryClient.setQueryData(
            orpc.mail.getHeldSend.queryOptions({
              input: { mailboxId, sendOperationId: draft.sendOperationId },
            }).queryKey,
            held
          );
        }
        if (held?.status === "canceled" || held?.status === "accepted") {
          await finishHeldOperation(
            held.status === "accepted"
              ? { kind: "accepted" }
              : { draftId: held.draftId, kind: "canceled" }
          );
        } else if (held === null) {
          await restoreHeldMessage();
        }
        return;
      }
      if (draft.scheduleAttempt) {
        const recovered = await recoverComposeSchedule({
          draft: buildDraftFromForm(form.state.values),
          mailboxId,
        });
        if (!isCurrentComposeAction(action, { allowUncertain: true })) {
          return;
        }
        if (recovered.status === "editable") {
          setDraft(recovered.draft);
          recovery.checkpoint();
          return;
        }
        await completeScheduledMessage({
          message: draft,
          scheduled: recovered.scheduled,
          scheduledMailboxId: mailboxId,
        });
        return;
      }
      const delivery = await rpc.mail.getComposeSendStatus({
        mailboxId,
        sendOperationId: draft.sendOperationId,
      });
      if (!isCurrentComposeAction(action, { allowUncertain: true })) {
        return;
      }
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
          if (!isCurrentComposeAction(action)) {
            return;
          }
          form.setFieldValue("bodyHtml", prepared.bodyHtml);
        } catch (error) {
          if (!isCurrentComposeAction(action)) {
            return;
          }
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
      if (isCurrentComposeAction(action, { allowUncertain: true })) {
        toastError(error, {
          boundary: draft.scheduleAttempt
            ? "compose-check-schedule"
            : "compose-check-delivery",
          fallback: draft.scheduleAttempt
            ? "Could not confirm the schedule. Please try again."
            : "Could not check delivery. Please try again.",
        });
      }
    } finally {
      finishComposeAction(action);
    }
  };

  const heldSendQuery = useQuery({
    ...orpc.mail.getHeldSend.queryOptions({
      input: {
        mailboxId: mailboxId ?? "",
        sendOperationId: state.draft.sendOperationId ?? "",
      },
    }),
    enabled:
      !!mailboxId &&
      state.draft.holdAttempt === true &&
      state.draft.sendUncertain === true,
    refetchInterval: (query) =>
      ["accepted", "canceled", "failed"].includes(
        query.state.data?.status ?? ""
      )
        ? false
        : 1000,
    retry: false,
  });

  const finishHeldSend = useEffectEvent(async () => {
    const held = heldSendQuery.data;
    if (
      held?.sendOperationId !== activeDraftRef.current.sendOperationId ||
      (held?.status !== "accepted" && held?.status !== "canceled")
    ) {
      return;
    }
    await finishHeldOperation(
      held.status === "accepted"
        ? { kind: "accepted" }
        : { draftId: held.draftId, kind: "canceled" }
    );
  });
  useEffect(() => {
    if (
      heldSendQuery.data?.status === "accepted" ||
      heldSendQuery.data?.status === "canceled"
    ) {
      void finishHeldSend();
    }
  }, [
    heldSendQuery.data?.status,
    heldSendQuery.data?.draftId,
    heldSendQuery.data?.sendOperationId,
  ]);

  useEffect((): (() => void) | undefined => {
    if (
      !editorReady ||
      !agentWorkspace ||
      agentWorkspace.mailboxId !== mailboxId
    ) {
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
    const bridge = {
      applyHeldReceipt: async (receipt: ComposeHeldReceipt) => {
        await applyHeldReceipt(receipt);
      },
      applyReceipt: (receipt: Parameters<ComposeBridge["applyReceipt"]>[0]) => {
        const matchesRevision =
          receipt.draftRevision === draftRevisionRef.current;
        if (receipt.status === "draft_saved" || matchesRevision) {
          applyAssistantReceipt(receipt, matchesRevision);
        }
      },
      edit: (values: Partial<ComposeFormValues>, expectedRevision: number) => {
        if (
          expectedRevision !== draftRevisionRef.current ||
          finishingRef.current ||
          activeDraftRef.current.sendUncertain === true ||
          activeDraftRef.current.saveStatus === "sending" ||
          activeDraftRef.current.saveStatus === "saving"
        ) {
          throw new Error("The draft changed. Read it again before editing.");
        }
        let bodyHtml: string | undefined;
        if (values.bodyText !== undefined) {
          const currentBody = new DOMParser().parseFromString(
            form.state.values.bodyHtml,
            "text/html"
          );
          const retainedParts = [
            ...currentBody.body.querySelectorAll<HTMLElement>(
              ':scope > [data-compose-quote], :scope > [data-quieter-signature="true"]'
            ),
          ];
          const retainedHtml = retainedParts
            .map((element) => element.outerHTML)
            .join("");
          const retainedImages = getReferencedComposeActionImages(
            retainedHtml,
            activeDraftRef.current.inlineImages
          );
          if (
            activeDraftRef.current.inlineImages.some(
              (asset) => !retainedImages.some((image) => image.id === asset.id)
            ) ||
            (activeDraftRef.current.draftAnchor &&
              !currentBody.body.querySelector(":scope > [data-compose-quote]"))
          ) {
            throw new Error(
              "Edit this message in the composer to keep its images and conversation quote intact."
            );
          }
          bodyHtml = `${textToComposeBodyHtml(values.bodyText)}${retainedHtml}`;
        }
        draftRevisionRef.current += 1;
        setDraft((current) => ({ ...current, assistantUnsaved: true }));
        for (const field of ["to", "cc", "bcc", "subject"] as const) {
          const value = values[field];
          if (value !== undefined) {
            form.setFieldValue(field, value);
          }
        }
        if (bodyHtml !== undefined) {
          form.setFieldValue("bodyHtml", bodyHtml);
          form.setFieldValue("bodyText", getTextFromHtml(bodyHtml));
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
        checkpointRecovery();
      },
      read: () => ({
        attachments: activeDraftRef.current.attachments,
        baseRevision: activeDraftRef.current.baseRevision,
        draftAnchor: activeDraftRef.current.draftAnchor,
        draftId: activeDraftRef.current.localId,
        draftRevision: draftRevisionRef.current,
        followUpReminder: activeDraftRef.current.followUpReminder,
        inlineImages: activeDraftRef.current.inlineImages,
        messageId: activeDraftRef.current.messageId,
        providerDraftId: activeDraftRef.current.draftId,
        replyContext: activeDraftRef.current.replyContext,
        sendOperationId: activeDraftRef.current.sendOperationId,
        sendUncertain: activeDraftRef.current.sendUncertain,
        values: { ...form.state.values },
      }),
    };
    const unregister = agentWorkspace.registerCompose(bridge);
    return () => {
      subscription.unsubscribe();
      unregister();
    };
  }, [agentWorkspace, editorReady, form, getTextFromHtml, mailboxId]);

  const handleDialogOpenChange = (open: boolean) => {
    if (open) {
      setState((current) => ({ ...current, open: true }));
    } else {
      void closeComposeDialog();
    }
  };

  const discardActiveDraft = async () => {
    if (
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending" ||
      finishingRef.current
    ) {
      return;
    }
    const action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    await savingRef.current;
    if (!isCurrentComposeAction(action)) {
      finishComposeAction(action);
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
      if (isCurrentComposeAction(action)) {
        setDraft({
          ...draft,
          errorMessage: "Your draft could not be deleted. Please try again.",
          saveStatus: "error",
        });
        toastError(error, { boundary: "compose-discard" });
      }
      return;
    } finally {
      finishComposeAction(action);
    }
    if (!isCurrentComposeAction(action)) {
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
    const action = captureComposeAction();
    finishingActionRef.current = action;
    finishingRef.current = true;
    actionRunningRef.current = true;
    setState((current) => ({ ...current, isFinishing: true }));
    let prepared: ComposeDraftState | null = null;
    try {
      await savingRef.current;
      if (!isCurrentComposeAction(action)) {
        return;
      }
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
      if (!isCurrentComposeAction(action) || queuedActionRef.current) {
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
        assistantUnsaved:
          current.assistantUnsaved === true || next.assistantUnsaved === true,
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
      if (isCurrentComposeAction(action) && !queuedActionRef.current) {
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
      actionRunningRef.current = false;
      finishComposeAction(action);
      const queued = queuedActionRef.current;
      queuedActionRef.current = null;
      if (queued && isCurrentComposeAction(action, { allowNewerEdits: true })) {
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

  const addMessageAttachment = (
    attachment: MessageAttachment,
    messageId: string
  ) => {
    if (
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }
    try {
      const draft = addComposeMessageAttachment(
        activeDraftRef.current,
        attachment,
        messageId
      );
      draftRevisionRef.current += 1;
      handleUserDraftChange();
      setDraft({ ...draft, saveStatus: activeDraftRef.current.saveStatus });
      recovery.checkpoint();
    } catch (error) {
      toastError(error, {
        boundary: "compose-attachments",
        fallback:
          "Could not attach that file. Keep attachments under 24 MB and try again.",
      });
    }
  };

  const renameAttachment = (id: string, name: string) => {
    const trimmed = name.trim();
    if (
      !trimmed ||
      /[\r\n\0]/u.test(trimmed) ||
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending" ||
      !activeDraftRef.current.attachments.some(
        (attachment) => attachment.id === id && attachment.name !== trimmed
      )
    ) {
      return;
    }
    handleUserDraftChange();
    draftRevisionRef.current += 1;
    setDraft((current) => ({
      ...current,
      attachments: current.attachments.map((attachment) =>
        attachment.id === id ? { ...attachment, name: trimmed } : attachment
      ),
      updatedAt: Date.now(),
    }));
    recovery.checkpoint();
  };

  const handleFollowUpReminderChange = (
    followUpReminder: FollowUpReminderIntent | null
  ) => {
    if (
      finishingRef.current ||
      activeDraftRef.current.sendUncertain === true ||
      activeDraftRef.current.saveStatus === "sending"
    ) {
      return;
    }
    handleUserDraftChange();
    draftRevisionRef.current += 1;
    setDraft((current) => ({
      ...current,
      followUpReminder,
      updatedAt: Date.now(),
    }));
    recovery.checkpoint();
  };

  return {
    addAttachmentFiles,
    addInlineImageFiles,
    addMessageAttachment,
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
    discardActiveDraft,
    form,
    handleDialogOpenChange,
    handleFollowUpReminderChange,
    handleScheduleMessage,
    handleUserDraftChange,
    heldSendQuery,
    prepareSenderSwitch,
    removeAttachment,
    renameAttachment,
    restoreHeldMessage,
    saveDraft: async () => {
      if (
        finishingRef.current ||
        activeDraftRef.current.sendUncertain === true ||
        activeDraftRef.current.saveStatus === "sending"
      ) {
        return;
      }
      await persistCurrentDraft(false, false, true);
    },
    saveDraftCopy,
    setActiveDraftError,
    state,
    toggleRecipientVisibility,
  };
};

export type ComposeDialogController = ReturnType<
  typeof useComposeDialogController
>;
