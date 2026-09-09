import { composeDraftAnchorSchema } from "@quieter/mail/compose/schema";
import { z } from "zod";

import type { ComposeDraftState } from "./draft";

const assetSchema = z.object({
  gmailAttachmentId: z.string().optional(),
  id: z.string(),
  mimeType: z.string(),
  name: z.string(),
  size: z.number(),
});

export const recoverableDraftSchema = z.object({
  attachments: z.array(assetSchema.extend({ isInline: z.literal(false) })),
  baseVersion: z.string().optional(),
  bodyHtml: z.string(),
  bodyText: z.string(),
  conflict: z.boolean().optional(),
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
