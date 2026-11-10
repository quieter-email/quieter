import { ORPCError } from "@orpc/server";
import { normalizeComposeBodyHtml } from "@quieter/mail/compose/mime";
import {
  composeDraftInputSchema,
  composeMessageInputSchema,
} from "@quieter/mail/compose/schema";
import { z } from "zod";

const storedAttachmentSchema = composeDraftInputSchema.shape.attachments.element
  .omit({ file: true })
  .extend({ content: z.string() });
const storedInlineImageSchema =
  composeDraftInputSchema.shape.inlineImages.element
    .omit({ file: true })
    .extend({ content: z.string() });
export const scheduledSendPayloadSchema = composeDraftInputSchema.extend({
  attachments: z.array(storedAttachmentSchema),
  inlineImages: z.array(storedInlineImageSchema),
});
export type ScheduledSendPayload = z.infer<typeof scheduledSendPayloadSchema>;
type ComposeMessage = z.infer<typeof composeMessageInputSchema>;

export const captureScheduledSendPayload = async (
  message: ComposeMessage
): Promise<ScheduledSendPayload> => {
  const files = [...message.attachments, ...message.inlineImages];
  let totalBytes = 0;
  for (const asset of files) {
    if (!(asset.file instanceof File)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "An attachment is missing. Attach the file again before scheduling.",
      });
    }
    totalBytes += asset.file.size;
  }
  if (
    totalBytes > 24 * 1024 * 1024 ||
    Buffer.byteLength(message.bodyHtml) + Buffer.byteLength(message.bodyText) >
      1024 * 1024
  ) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message is too large to schedule.",
    });
  }
  const [attachments, inlineImages] = await Promise.all([
    Promise.all(
      message.attachments.map(async ({ file, ...asset }) => {
        if (file === undefined) {
          throw new ORPCError("BAD_REQUEST", {
            message: "An attachment is missing.",
          });
        }
        return {
          ...asset,
          content: Buffer.from(await file.arrayBuffer()).toString("base64"),
          size: file.size,
        };
      })
    ),
    Promise.all(
      message.inlineImages.map(async ({ file, ...asset }) => {
        if (file === undefined) {
          throw new ORPCError("BAD_REQUEST", {
            message: "An attachment is missing.",
          });
        }
        return {
          ...asset,
          content: Buffer.from(await file.arrayBuffer()).toString("base64"),
          size: file.size,
        };
      })
    ),
  ]);
  return {
    ...message,
    attachments,
    bodyHtml: normalizeComposeBodyHtml(message),
    inlineImages,
  };
};

export const restoreScheduledSendPayload = (
  payload: ScheduledSendPayload,
  identity: { localId: string; sendOperationId: string }
): ComposeMessage =>
  composeMessageInputSchema.parse({
    ...payload,
    ...identity,
    attachments: payload.attachments.map(({ content, ...asset }) => ({
      ...asset,
      file: new File([Buffer.from(content, "base64")], asset.name, {
        type: asset.mimeType,
      }),
    })),
    baseRevision: undefined,
    draftId: null,
    errorMessage: null,
    inlineImages: payload.inlineImages.map(({ content, ...asset }) => ({
      ...asset,
      file: new File([Buffer.from(content, "base64")], asset.name, {
        type: asset.mimeType,
      }),
    })),
    lastSavedAt: null,
    messageId: null,
    saveStatus: "idle",
    sendUncertain: false,
  });
