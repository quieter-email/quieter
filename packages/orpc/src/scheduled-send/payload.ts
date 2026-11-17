import { ORPCError } from "@orpc/server";
import { normalizeComposeBodyHtml } from "@quieter/mail/compose/mime";
import {
  composeDraftInputSchema,
  composeMessageEnvelopeSchema,
} from "@quieter/mail/compose/schema";
import { z } from "zod";

import { aiOperationOriginSchema } from "../ai-authority";
import type { AiOperationOrigin } from "../ai-authority";
import { composeSnippetQuoteProofSchema } from "../mail/snippet-quote-provenance";
import type { ComposeSnippetQuoteProof } from "../mail/snippet-quote-provenance";
import { hashRequest } from "../request-hash";

const storedAttachmentSchema = composeDraftInputSchema.shape.attachments.element
  .omit({ file: true })
  .extend({ content: z.string() });
const storedInlineImageSchema =
  composeDraftInputSchema.shape.inlineImages.element
    .omit({ file: true })
    .extend({ content: z.string() });
export const scheduledSendPayloadSchema = composeDraftInputSchema
  .extend({
    attachments: z.array(storedAttachmentSchema),
    inlineImages: z.array(storedInlineImageSchema),
  })
  .strict();
export type ScheduledSendPayload = z.infer<typeof scheduledSendPayloadSchema>;
type ComposeMessage = z.infer<typeof composeMessageEnvelopeSchema>;

const boundScheduledSendPayloadSchema = z.strictObject({
  actorUserId: z.string().min(1),
  formatVersion: z.literal(1),
  mailboxId: z.string().min(1),
  message: scheduledSendPayloadSchema,
  origin: aiOperationOriginSchema,
  privateContext: z.boolean(),
  requestHash: z.string().min(1),
  sendOperationId: z.string().min(1),
  snippetQuote: z.unknown().optional(),
});
type SendBinding = Pick<
  z.infer<typeof boundScheduledSendPayloadSchema>,
  "actorUserId" | "mailboxId" | "requestHash" | "sendOperationId"
>;

const scheduledCancellationAuthoritySchema = z.strictObject({
  origin: aiOperationOriginSchema,
  privateContext: z.boolean(),
});

export const readScheduledCancellationAuthority = (
  value: unknown,
  binding: Pick<SendBinding, "actorUserId" | "mailboxId">,
  captured: { format: "bound" | "legacy"; privateContext: boolean }
): z.infer<typeof scheduledCancellationAuthoritySchema> => {
  if ((value === null || value === undefined) && captured.format === "legacy") {
    return { origin: { kind: "human" }, privateContext: false };
  }
  const parsed = scheduledCancellationAuthoritySchema.safeParse(value);
  if (
    !parsed.success ||
    (parsed.data.origin.kind === "ai" &&
      (parsed.data.origin.userId !== binding.actorUserId ||
        parsed.data.origin.mailboxId !== binding.mailboxId))
  ) {
    throw new ORPCError("FORBIDDEN", {
      message:
        "Sending is cancelled. Choose Return to Drafts to authorize recovery.",
    });
  }
  return {
    origin: parsed.data.origin,
    privateContext:
      parsed.data.origin.kind === "ai" &&
      (captured.privateContext || parsed.data.privateContext),
  };
};

export const hashScheduledSendPayload = (payload: ScheduledSendPayload) =>
  hashRequest({
    attachments: payload.attachments.map(
      ({ content, contentId, isInline, mimeType, name }) => ({
        content,
        contentId,
        isInline,
        mimeType,
        name,
      })
    ),
    bodyHtml: payload.bodyHtml,
    bodyText: payload.bodyText,
    draftAnchor: payload.draftAnchor,
    followUpReminder: payload.followUpReminder,
    headers: payload.headers,
    inlineImages: payload.inlineImages.map(
      ({ content, contentId, isInline, mimeType, name }) => ({
        content,
        contentId,
        isInline,
        mimeType,
        name,
      })
    ),
    recipients: payload.recipients,
    replyContext: payload.replyContext,
    senderName: payload.senderName,
    subject: payload.subject,
  });

export const readScheduledSendPayload = (
  value: unknown,
  binding: SendBinding
): {
  format: "bound" | "legacy";
  message: ScheduledSendPayload;
  origin: AiOperationOrigin;
  privateContext: boolean;
  snippetQuote?: ComposeSnippetQuoteProof;
} => {
  const hasEnvelope =
    typeof value === "object" &&
    value !== null &&
    ("formatVersion" in value || "origin" in value || "authority" in value);
  const parsed = hasEnvelope
    ? boundScheduledSendPayloadSchema.safeParse(value)
    : scheduledSendPayloadSchema.safeParse(value);
  if (!parsed.success) {
    throw new ORPCError("FORBIDDEN", {
      data: { sendNotStarted: true },
      message:
        "This saved message could not be authorized. Return it to Drafts.",
    });
  }
  const stored = parsed.data;
  const message = "formatVersion" in stored ? stored.message : stored;
  // Unwrapped snapshots predate assistant-held sends and have only human producers.
  const origin =
    "formatVersion" in stored ? stored.origin : { kind: "human" as const };
  if (
    hashScheduledSendPayload(message) !== binding.requestHash ||
    ("formatVersion" in stored &&
      (stored.actorUserId !== binding.actorUserId ||
        stored.mailboxId !== binding.mailboxId ||
        stored.requestHash !== binding.requestHash ||
        stored.sendOperationId !== binding.sendOperationId)) ||
    (origin.kind === "ai" &&
      (origin.userId !== binding.actorUserId ||
        origin.mailboxId !== binding.mailboxId))
  ) {
    throw new ORPCError("FORBIDDEN", {
      data: { sendNotStarted: true },
      message: "This saved message belongs to a different send attempt.",
    });
  }
  const snippetQuote = composeSnippetQuoteProofSchema.safeParse(
    "formatVersion" in stored ? stored.snippetQuote : undefined
  );
  return {
    format: "formatVersion" in stored ? "bound" : "legacy",
    message,
    origin,
    privateContext: "formatVersion" in stored ? stored.privateContext : false,
    snippetQuote: snippetQuote.success ? snippetQuote.data : undefined,
  };
};

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
  composeMessageEnvelopeSchema.parse({
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
