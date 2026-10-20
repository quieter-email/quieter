import type { ComposeDraftState } from "@quieter/app/features/compose/domain/draft";
import { draftRecoveryJournal } from "@quieter/app/lib/draft-recovery-journal";
import { composeDraftAnchorSchema } from "@quieter/mail/compose/schema";
import { z } from "zod";

const assetSchema = z.object({
  gmailAttachmentId: z.string().optional(),
  id: z.string(),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
  sourceMessageId: z.string().optional(),
});

export const recoverableDraftSchema = z.object({
  assistantUnsaved: z.boolean().optional(),
  attachments: z.array(assetSchema.extend({ isInline: z.literal(false) })),
  baseRevision: z.string().optional(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  draftAnchor: composeDraftAnchorSchema.nullable().optional(),
  draftId: z.string().optional(),
  errorMessage: z.string().nullable(),
  inlineImages: z.array(
    assetSchema.extend({ contentId: z.string(), isInline: z.literal(true) })
  ),
  lastSavedAt: z.number().optional(),
  localId: z.string(),
  messageId: z.string().optional(),
  recipients: z.object({ bcc: z.string(), cc: z.string(), to: z.string() }),
  recoveryLocalId: z.string().optional(),
  recoveryMissingFiles: z.array(z.string()).optional(),
  replyContext: z
    .object({
      messageHeaderId: z.string().optional(),
      references: z.array(z.string()),
      threadId: z.string(),
    })
    .nullable()
    .optional(),
  saveStatus: z.enum(["idle", "saving", "saved", "error", "sending"]),
  sendOperationId: z.uuid().optional(),
  sendUncertain: z.boolean().optional(),
  subject: z.string(),
  updatedAt: z.number(),
});

export const restoreComposeDraft = (
  payload: string,
  editorId: string,
  updatedAt = 0,
  savedDraft?: ComposeDraftState
): ComposeDraftState => {
  const draft = recoverableDraftSchema.parse(JSON.parse(payload));
  if (
    savedDraft?.draftId &&
    savedDraft.draftId === draft.draftId &&
    savedDraft.baseRevision === draft.baseRevision
  ) {
    draft.attachments = draft.attachments.map((asset) => {
      if (
        asset.gmailAttachmentId !== undefined ||
        asset.sourceMessageId === undefined ||
        asset.sourceMessageId !== savedDraft.messageId
      ) {
        return asset;
      }
      const matches = savedDraft.attachments.filter(
        (saved) =>
          saved.name === asset.name &&
          saved.mimeType === asset.mimeType &&
          saved.size === asset.size
      );
      return matches.length === 1 && matches[0] !== undefined
        ? { ...matches[0], id: asset.id }
        : asset;
    });
    draft.inlineImages = draft.inlineImages.map((asset) => {
      if (
        asset.gmailAttachmentId !== undefined ||
        asset.sourceMessageId === undefined ||
        asset.sourceMessageId !== savedDraft.messageId
      ) {
        return asset;
      }
      const saved = savedDraft.inlineImages.find(
        (image) => image.contentId === asset.contentId
      );
      return saved === undefined ? asset : { ...saved, id: asset.id };
    });
  }
  const missing = [...draft.attachments, ...draft.inlineImages].filter(
    (asset) => asset.gmailAttachmentId === undefined
  );
  const recoveryMissingFiles = [
    ...new Set([
      ...(draft.recoveryMissingFiles ?? []),
      ...missing.map((asset) => asset.name),
    ]),
  ];
  let { errorMessage } = draft;
  if (draft.saveStatus === "sending") {
    errorMessage =
      "Delivery was interrupted. Check Sent before sending this message again.";
  }
  if (recoveryMissingFiles.length > 0) {
    const fileWarning = `Your text was recovered. Reattach these files before sending: ${recoveryMissingFiles.join(", ")}.`;
    errorMessage =
      draft.sendUncertain === true || draft.saveStatus === "sending"
        ? `Delivery could not be confirmed. Check Sent before sending again. ${fileWarning}`
        : fileWarning;
  }
  const bodyHtml = draft.bodyHtml.replaceAll(
    /<img\b[^>]*\bsrc=["']blob:[^"']*["'][^>]*>/giu,
    (element) => {
      const image = draft.inlineImages.find(
        (asset) =>
          element.includes(`data-compose-inline-id="${asset.id}"`) ||
          element.includes(`data-compose-inline-id='${asset.id}'`)
      );
      return image?.gmailAttachmentId
        ? element.replace(
            /\bsrc=["'][^"']*["']/iu,
            `src="cid:${image.contentId}"`
          )
        : "";
    }
  );
  return {
    ...draft,
    attachments: draft.attachments.filter(
      (asset) => asset.gmailAttachmentId !== undefined
    ),
    bodyHtml,
    errorMessage,
    inlineImages: draft.inlineImages.filter(
      (asset) => asset.gmailAttachmentId !== undefined
    ),
    recoveryEditorId: editorId,
    recoveryMissingFiles,
    recoveryUpdatedAt: updatedAt,
    saveStatus: errorMessage === null ? "idle" : "error",
    sendUncertain:
      draft.sendUncertain === true || draft.saveStatus === "sending",
  };
};

export const findRecoverableComposeDraft = (
  mailboxId: string,
  draft: ComposeDraftState
): ComposeDraftState | null => {
  const draftId = draft.draftId?.trim() ?? "";
  const threadId =
    draft.draftAnchor?.sourceThreadId ?? draft.replyContext?.threadId;
  let threadRecovery: ComposeDraftState | null = null;
  for (const record of draftRecoveryJournal.listRecoverable(mailboxId)) {
    if (record.updatedAt <= (draft.lastSavedAt ?? 0)) {
      continue;
    }
    let recovered: ComposeDraftState;
    try {
      recovered = restoreComposeDraft(
        record.payload,
        record.editorId,
        record.updatedAt,
        draft
      );
    } catch {
      continue;
    }
    const recoveredDraftId = recovered.draftId?.trim() ?? "";
    if (
      draftId !== "" &&
      recoveredDraftId !== "" &&
      recoveredDraftId !== draftId
    ) {
      continue;
    }
    const recoveredThreadId =
      recovered.draftAnchor?.sourceThreadId ?? recovered.replyContext?.threadId;
    const matchesIdentity =
      record.localId === draft.localId ||
      (draftId !== "" && recoveredDraftId === draftId);
    const matchesThread =
      draftId === "" &&
      (threadId?.trim() ?? "") !== "" &&
      recoveredThreadId === threadId &&
      (draft.draftAnchor?.seededBy === "forward") ===
        (recovered.draftAnchor?.seededBy === "forward");
    if (matchesIdentity) {
      return {
        ...recovered,
        draftId: recovered.draftId ?? draft.draftId,
        messageId: recovered.messageId ?? draft.messageId,
      };
    }
    if (matchesThread && threadRecovery === null) {
      threadRecovery = {
        ...recovered,
        draftId: recovered.draftId ?? draft.draftId,
        messageId: recovered.messageId ?? draft.messageId,
      };
    }
  }
  return threadRecovery;
};
