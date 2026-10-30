import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import {
  decodeMimeHeaderValue,
  extractInlineMessageAttachments,
  extractMessageAttachments,
  extractMessageContent,
} from "@quieter/mail/message-content";
import { extractMessageIds } from "@quieter/mail/message-id";

import type { GmailDraft } from "../service";

export const parseDraftMessage = (
  draft: GmailDraft,
  resolvedContent?: { bodyHtml?: string; bodyText?: string }
) => {
  const { message } = draft;
  if (!message) {
    return {
      attachments: [],
      bodyHtml: "",
      bodyText: "",
      draftAnchor: null,
      inReplyTo: null,
      inlineImages: [],
      messageId: null,
      recipients: {
        bcc: "",
        cc: "",
        to: "",
      },
      replyContext: null,
      subject: "",
    };
  }

  const content = extractMessageContent(message.payload);
  const bodyHtml = resolvedContent?.bodyHtml ?? content.html ?? "";
  const bodyText = resolvedContent?.bodyText ?? content.text ?? "";
  const headers = message.payload?.headers ?? [];
  const readHeader = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? "";
  const draftAnchor = parseDraftAnchorFromHeaderReader(readHeader) ?? null;
  const inReplyTo = readHeader("In-Reply-To").trim();
  const references = [...new Set(extractMessageIds(readHeader("References")))];

  return {
    attachments: extractMessageAttachments(message.payload, bodyHtml),
    bodyHtml,
    bodyText,
    draftAnchor,
    inReplyTo: inReplyTo || null,
    inlineImages: extractInlineMessageAttachments(message.payload, bodyHtml),
    messageId: message.id,
    recipients: {
      bcc: decodeMimeHeaderValue(readHeader("Bcc")) ?? "",
      cc: decodeMimeHeaderValue(readHeader("Cc")) ?? "",
      to: decodeMimeHeaderValue(readHeader("To")) ?? "",
    },
    replyContext: message.threadId
      ? {
          messageHeaderId: inReplyTo || undefined,
          references,
          threadId: message.threadId,
        }
      : null,
    subject: decodeMimeHeaderValue(readHeader("Subject")) ?? "",
  };
};
