import MailComposer from "nodemailer/lib/mail-composer";
import type { z } from "zod";

import type { composeDraftInputSchema } from "./schema";
import { QUIETER_DRAFT_HEADER_NAMES, splitMailAddressList } from "./schema";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;

export const normalizeComposeBodyHtml = (
  draft: Pick<ComposeDraftInput, "bodyHtml" | "inlineImages">
): string =>
  (draft.bodyHtml || "<p></p>").replaceAll(
    /<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu,
    (tag) => {
      const imageId =
        /\sdata-compose-inline-id\s*=\s*["'](?<id>[^"']+)["']/iu.exec(tag)
          ?.groups?.id;
      const sourceMatch =
        /\ssrc\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s>]+))/iu.exec(
          tag
        );
      const source =
        sourceMatch?.groups?.double ??
        sourceMatch?.groups?.single ??
        sourceMatch?.groups?.bare;
      const image = draft.inlineImages.find(
        (asset) =>
          asset.id === imageId ||
          source?.toLowerCase() === `cid:${asset.contentId.toLowerCase()}`
      );
      if (image) {
        const cid = `cid:${image.contentId.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}`;
        const withoutId = tag.replaceAll(
          /\s+data-compose-inline-id\s*=\s*["'][^"']*["']/giu,
          ""
        );
        return /\ssrc\s*=/iu.test(withoutId)
          ? withoutId.replace(
              /\ssrc\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/iu,
              ` src="${cid}"`
            )
          : withoutId.replace(/<img\b/iu, `<img src="${cid}"`);
      }
      if (source?.startsWith("blob:") === true) {
        throw new Error("An inline image is missing its file content.");
      }
      return tag;
    }
  );

export const buildMimeMessage = async (
  draft: ComposeDraftInput,
  options?: {
    from?: string | { address: string; name: string };
    htmlTransform?: (html: string) => string;
    includeQuieterDraftHeaders?: boolean;
    messageId?: string;
    omitBccHeader?: boolean;
    sentAt?: Date;
  }
): Promise<string> => {
  const headers = (draft.headers ?? []).map(({ name, value }) => ({
    key: name,
    value,
  }));
  if (options?.includeQuieterDraftHeaders === true && draft.draftAnchor) {
    for (const field of [
      "seededBy",
      "sourceMessageHeaderId",
      "sourceMessageId",
      "sourceThreadId",
    ] as const) {
      const value = draft.draftAnchor[field];
      if (value !== undefined && value !== null && value !== "") {
        headers.push({ key: QUIETER_DRAFT_HEADER_NAMES[field], value });
      }
    }
  }
  const files = [
    ...draft.inlineImages.map((image) => ({ ...image, disposition: "inline" })),
    ...draft.attachments
      .filter((attachment) => !attachment.isInline)
      .map((attachment) => ({
        ...attachment,
        contentId: undefined,
        disposition: "attachment",
      })),
  ];
  const attachments = await Promise.all(
    files.map(async (attachment) => {
      if (!(attachment.file instanceof Blob)) {
        throw new Error("An attachment is missing its file content.");
      }
      return {
        cid: attachment.contentId,
        content: Buffer.from(await attachment.file.arrayBuffer()),
        contentDisposition: attachment.disposition,
        contentType: attachment.mimeType,
        filename: attachment.name,
      };
    })
  );
  const references = [
    ...new Set(
      [
        ...(draft.replyContext?.references ?? []),
        draft.replyContext?.messageHeaderId,
      ].filter(
        (value): value is string => value !== undefined && value.trim() !== ""
      )
    ),
  ];
  const html = normalizeComposeBodyHtml(draft);
  const message = new MailComposer({
    attachments,
    bcc: splitMailAddressList(draft.recipients.bcc),
    cc: splitMailAddressList(draft.recipients.cc),
    date: options?.sentAt,
    disableFileAccess: true,
    disableUrlAccess: true,
    from: options?.from,
    headers,
    html:
      options?.htmlTransform && draft.bodyHtml !== ""
        ? options.htmlTransform(html)
        : html,
    inReplyTo: draft.replyContext?.messageHeaderId,
    messageId: options?.messageId,
    newline: "\r\n",
    references,
    subject: draft.subject,
    text: draft.bodyText,
    to: splitMailAddressList(draft.recipients.to),
  }).compile();
  message.keepBcc = options?.omitBccHeader !== true;
  const raw = await message.build();
  return raw.toString("utf-8");
};

export const buildPlainTextMessage = async ({
  body,
  subject,
  to,
}: {
  body: string;
  subject: string;
  to: string;
}): Promise<string> => {
  const raw = await new MailComposer({
    disableFileAccess: true,
    disableUrlAccess: true,
    newline: "\r\n",
    subject,
    text: body,
    to,
  })
    .compile()
    .build();
  return raw.toString("utf-8");
};
