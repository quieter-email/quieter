import { createHash } from "node:crypto";

import { canonicalMailJson } from "@quieter/database/mail-ledger-json";
import {
  normalizeSendHeaders,
  sendMessageInputSchema,
  MAX_SEND_PAYLOAD_BYTES,
} from "@quieter/mail/send";
import { z } from "zod";

const submissionRequestSchema = sendMessageInputSchema
  .safeExtend({
    idempotencyKey: z
      .string()
      .regex(/^[\u0021-\u007E]{1,128}$/u)
      .optional(),
  })
  .strict();

export const normalizeMailSubmissionRequest = (input: unknown) => {
  const serialized = JSON.stringify(input);
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized) > MAX_SEND_PAYLOAD_BYTES
  ) {
    throw new Error("Submission exceeds the acceptance limit.");
  }
  const message = submissionRequestSchema.parse(input);
  if (message.attachments.length > 50) {
    throw new Error("Submission attachments exceed the supported contract.");
  }
  const normalized = {
    attachments: message.attachments.map((attachment) => {
      const bytes = Buffer.from(
        attachment.content.replaceAll(/\s+/gu, ""),
        "base64"
      );
      return {
        bytes: bytes.byteLength,
        contentId: attachment.contentId ?? null,
        contentType: attachment.contentType,
        digest: createHash("sha256").update(bytes).digest("hex"),
        disposition: attachment.disposition,
        filename: attachment.filename,
      };
    }),
    bcc: message.bcc ?? [],
    cc: message.cc ?? [],
    from: message.from,
    headers: normalizeSendHeaders(message.headers)
      .map((header) => ({ ...header, name: header.name.toLowerCase() }))
      .toSorted((a, b) => (a.name < b.name ? -1 : Number(a.name > b.name))),
    html: message.html ?? null,
    metadata: message.metadata ?? {},
    // Resolve a default only for a new acceptance; a settings change cannot invalidate a replay.
    openTracking: message.openTracking ?? null,
    replyTo: message.replyTo ?? [],
    schemaVersion: 1,
    subject: message.subject,
    tags: message.tags,
    text: message.text,
    to: message.to,
  };
  return {
    message,
    requestHash: createHash("sha256")
      .update(canonicalMailJson(normalized))
      .digest("hex"),
  };
};
