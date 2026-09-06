import { createHash, randomUUID } from "node:crypto";

import type { DatabaseClient } from "@quieter/database/client";
import {
  createMailPayloadUpload,
  completeMailPayloadUpload,
} from "@quieter/database/mail-payload-uploads";
import type {
  MailPayloadObject,
  MailSubmissionPayload,
} from "@quieter/database/schema";
import {
  buildSendMimeMessage,
  getSendEnvelopeAddress,
  normalizeSendHeaders,
  sendMessageInputSchema,
  MAX_SEND_PAYLOAD_BYTES,
} from "@quieter/mail/send";

export type SubmissionPayloadStorage = {
  write: (object: MailPayloadObject, bytes: Uint8Array) => Promise<void>;
  read: (object: MailPayloadObject) => Promise<Uint8Array>;
  remove: (key: string) => Promise<void>;
};

export const prepareMailSubmissionPayload = async (
  database: DatabaseClient,
  input: {
    organizationId: string;
    message: unknown;
    openTracking: boolean;
    transformHtml?: (html: string, messageHeaderId: string) => string;
    storage: SubmissionPayloadStorage;
  }
) => {
  if (
    Buffer.byteLength(JSON.stringify(input.message)) > MAX_SEND_PAYLOAD_BYTES
  ) {
    throw new Error("Submission exceeds the acceptance limit.");
  }
  const message = sendMessageInputSchema.parse(input.message);
  if (
    message.attachments.length > 50 ||
    message.tags.some((tag) => tag.name.toLowerCase().startsWith("quieter_"))
  ) {
    throw new Error(
      "Submission attachments or tags exceed the supported contract."
    );
  }
  const preparedAt = new Date();
  const messageHeaderId = `<${randomUUID()}@${getSendEnvelopeAddress(message.from).split("@").at(1) ?? "quieter.email"}>`;
  const transportHtml =
    message.html === undefined
      ? null
      : (input.transformHtml?.(message.html, messageHeaderId) ?? message.html);
  const built = buildSendMimeMessage(
    { ...message, html: transportHtml ?? undefined },
    { messageId: messageHeaderId, sentAt: preparedAt }
  );
  const recipientCount = new Set([...built.to, ...built.cc, ...built.bcc]).size;
  if (
    recipientCount < 1 ||
    recipientCount > 50 ||
    built.rawSizeBytes > MAX_SEND_PAYLOAD_BYTES
  ) {
    throw new Error("Submission exceeds the recipient or message size limit.");
  }
  const content = message.attachments.map(
    (attachment) => new Uint8Array(Buffer.from(attachment.content, "base64"))
  );
  const objects = content.map((bytes) => ({
    bytes: bytes.byteLength,
    digest: createHash("sha256").update(bytes).digest("hex"),
  }));
  const upload =
    objects.length === 0
      ? null
      : await createMailPayloadUpload(database, {
          objects,
          organizationId: input.organizationId,
        });
  if (upload !== null) {
    for (const [index, object] of upload.objects.entries()) {
      // oxlint-disable-next-line no-await-in-loop -- Keep per-request storage and memory bounded.
      await input.storage.write(object, content[index]);
      // oxlint-disable-next-line no-await-in-loop -- Verify every object before marking the lease ready.
      const stored = await input.storage.read(object);
      if (
        stored.byteLength !== object.bytes ||
        createHash("sha256").update(stored).digest("hex") !== object.digest
      ) {
        throw new Error("Prepared attachment failed integrity verification.");
      }
    }
    await completeMailPayloadUpload(database, {
      id: upload.id,
      organizationId: input.organizationId,
    });
  }
  const payload: MailSubmissionPayload = {
    attachments: message.attachments.map((attachment, index) => {
      const object = upload?.objects[index];
      if (object === undefined) {
        throw new Error("Prepared attachment has no upload manifest.");
      }
      return {
        ...object,
        contentId: attachment.contentId ?? null,
        contentType: attachment.contentType,
        disposition: attachment.disposition,
        filename: attachment.filename,
      };
    }),
    bcc: message.bcc ?? [],
    cc: message.cc ?? [],
    from: message.from,
    headers: normalizeSendHeaders(message.headers),
    html: message.html ?? null,
    messageHeaderId,
    metadata: message.metadata ?? {},
    openTracking: input.openTracking,
    preparedAt: preparedAt.toISOString(),
    replyTo: message.replyTo ?? [],
    subject: message.subject,
    tags: message.tags,
    text: message.text,
    to: message.to,
    transportHtml,
  };
  return {
    attachmentBytes: built.attachmentSizeBytes,
    messageBytes: built.rawSizeBytes,
    payload,
    payloadUploadId: upload?.id,
    recipientCount,
  };
};

export const readMailSubmissionMessage = async (input: {
  payload: MailSubmissionPayload;
  storage: SubmissionPayloadStorage;
}) => {
  const attachments = [];
  let bytes = 0;
  if (input.payload.attachments.length > 50) {
    throw new Error("Stored attachment manifest exceeds the limit.");
  }
  for (const attachment of input.payload.attachments) {
    bytes += attachment.bytes;
    if (!Number.isSafeInteger(bytes) || bytes > MAX_SEND_PAYLOAD_BYTES) {
      throw new Error("Stored attachment manifest exceeds the limit.");
    }
    // oxlint-disable-next-line no-await-in-loop -- Keep per-request memory and storage concurrency bounded.
    const content = await input.storage.read(attachment);
    if (
      content.byteLength !== attachment.bytes ||
      createHash("sha256").update(content).digest("hex") !== attachment.digest
    ) {
      throw new Error("Stored attachment failed integrity verification.");
    }
    attachments.push({
      content: Buffer.from(content).toString("base64"),
      contentId: attachment.contentId ?? undefined,
      contentType: attachment.contentType,
      disposition: attachment.disposition,
      filename: attachment.filename,
    });
  }
  const message = sendMessageInputSchema.parse({
    ...input.payload,
    attachments,
    bcc: input.payload.bcc.length === 0 ? undefined : input.payload.bcc,
    cc: input.payload.cc.length === 0 ? undefined : input.payload.cc,
    html: input.payload.transportHtml ?? undefined,
    replyTo:
      input.payload.replyTo.length === 0 ? undefined : input.payload.replyTo,
  });
  const preparedAt = new Date(input.payload.preparedAt);
  if (
    !Number.isFinite(preparedAt.getTime()) ||
    !/^<[^<>\r\n]+>$/u.test(input.payload.messageHeaderId)
  ) {
    throw new Error("Stored message metadata is invalid.");
  }
  const built = buildSendMimeMessage(message, {
    messageId: input.payload.messageHeaderId,
    sentAt: preparedAt,
  });
  if (built.rawSizeBytes > MAX_SEND_PAYLOAD_BYTES) {
    throw new Error("Stored message exceeds the size limit.");
  }
  return built;
};
