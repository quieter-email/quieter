import { composeDraftAnchorSchema } from "@quieter/mail/compose/schema";
import { z } from "zod";

import { draftRecoveryJournal } from "#/lib/draft-recovery-journal";

import type { ComposeDraftState } from "./draft";

const assetSchema = z.object({
  gmailAttachmentId: z.string().optional(),
  id: z.string(),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
});

export const recoverableDraftSchema = z.object({
  assistantUnsaved: z.boolean().optional(),
  attachments: z.array(assetSchema.extend({ isInline: z.literal(false) })),
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
  replyContext: z
    .object({
      messageHeaderId: z.string().optional(),
      references: z.array(z.string()),
      threadId: z.string(),
    })
    .nullable()
    .optional(),
  saveStatus: z.enum(["idle", "saving", "saved", "error", "sending"]),
  subject: z.string(),
  updatedAt: z.number(),
});

export const restoreComposeDraft = (
  payload: string,
  editorId: string,
  updatedAt = 0
): ComposeDraftState => {
  const draft = recoverableDraftSchema.parse(JSON.parse(payload));
  const missing = [...draft.attachments, ...draft.inlineImages].filter(
    (asset) => asset.gmailAttachmentId === undefined
  );
  let { errorMessage } = draft;
  if (draft.saveStatus === "sending") {
    errorMessage =
      "Delivery was interrupted. Check Sent before sending this message again.";
  }
  if (missing.length > 0) {
    errorMessage = `Your text was recovered. Reattach these files before sending: ${missing.map((asset) => asset.name).join(", ")}.`;
  }
  return {
    ...draft,
    attachments: draft.attachments.filter(
      (asset) => asset.gmailAttachmentId !== undefined
    ),
    bodyHtml: draft.bodyHtml.replaceAll(
      /<img\b[^>]*\bsrc=["']blob:[^"']*["'][^>]*>/giu,
      ""
    ),
    errorMessage,
    inlineImages: draft.inlineImages.filter(
      (asset) => asset.gmailAttachmentId !== undefined
    ),
    recoveryEditorId: editorId,
    recoveryUpdatedAt: updatedAt,
    saveStatus: "error",
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
        record.updatedAt
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
