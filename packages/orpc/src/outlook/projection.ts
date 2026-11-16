import {
  boundMailCaptureContent,
  truncateMailCaptureText,
} from "@quieter/mail/capture";
import {
  outlookAttachmentSchema,
  outlookMessageSchema,
} from "@quieter/outlook/graph";
import type { OutlookAttachment, OutlookMessage } from "@quieter/outlook/graph";
import { z } from "zod";

const content = z.object({
  attachments: z.array(outlookAttachmentSchema).max(128),
  message: outlookMessageSchema,
  truncation: z.object({
    attachments: z.boolean(),
    bodyHtml: z.boolean(),
    bodyText: z.boolean(),
    headers: z.boolean(),
  }),
});

export const outlookProjectionSchema = z.discriminatedUnion("kind", [
  content.extend({ kind: z.literal("metadata") }),
  content.extend({
    kind: z.literal("full"),
    message: outlookMessageSchema.extend({
      body: z.object({
        content: z.string(),
        contentType: z.enum(["html", "text"]),
      }),
    }),
  }),
  content.extend({ kind: z.literal("truncated") }),
]);

export type OutlookProjection = z.infer<typeof outlookProjectionSchema>;

export const createOutlookProjection = (
  input:
    | { kind: "metadata"; message: OutlookMessage }
    | {
        attachments: OutlookAttachment[];
        kind: "full";
        message: OutlookMessage;
      }
): OutlookProjection => {
  const bounded = boundMailCaptureContent({
    bodyHtml:
      input.message.body?.contentType === "html"
        ? input.message.body.content
        : null,
    bodyText:
      input.message.body?.contentType === "text"
        ? input.message.body.content
        : null,
    headers: input.message.internetMessageHeaders ?? [],
  });
  const attachments =
    input.kind === "full"
      ? input.attachments.slice(0, 128).map((attachment) => ({
          ...attachment,
          contentType:
            attachment.contentType === null ||
            attachment.contentType === undefined
              ? attachment.contentType
              : truncateMailCaptureText(attachment.contentType, 256),
          name: truncateMailCaptureText(attachment.name, 512),
        }))
      : [];
  const truncation = {
    ...bounded.truncation,
    attachments:
      input.kind === "full" &&
      (input.attachments.length > attachments.length ||
        input.attachments.some(
          (attachment, index) =>
            attachment.name !== attachments[index]?.name ||
            attachment.contentType !== attachments[index]?.contentType
        )),
  };
  const message = {
    ...input.message,
    body:
      input.kind === "metadata" || input.message.body === undefined
        ? undefined
        : {
            content:
              input.message.body.contentType === "html"
                ? (bounded.bodyHtml ?? "")
                : (bounded.bodyText ?? ""),
            contentType: input.message.body.contentType,
          },
    internetMessageHeaders:
      input.kind === "metadata" ? undefined : bounded.headers,
  };
  let kind: OutlookProjection["kind"] = "metadata";
  if (input.kind === "full") {
    kind = Object.values(truncation).some(Boolean) ? "truncated" : "full";
  }
  return outlookProjectionSchema.parse({
    attachments,
    kind,
    message,
    truncation,
  });
};
