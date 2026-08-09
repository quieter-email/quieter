import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import {
  extractInlineMessageAttachments,
  extractMessageAttachments,
  extractMessageContent,
} from "@quieter/mail/message-content";

import type { GmailDraft } from "../service";

export const parseDraftMessage = (draft: GmailDraft) => {
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
  const headers = message.payload?.headers ?? [];
  const readHeader = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? "";
  const draftAnchor = parseDraftAnchorFromHeaderReader(readHeader) ?? null;
  const inReplyTo = readHeader("In-Reply-To").trim();
  const referenceMatches = readHeader("References").match(/<[^>]+>/gu);
  const references = referenceMatches ? [...new Set(referenceMatches)] : [];

  return {
    attachments: extractMessageAttachments(message.payload),
    bodyHtml: content.html ?? "",
    bodyText: content.text ?? "",
    draftAnchor,
    inReplyTo: inReplyTo || null,
    inlineImages: extractInlineMessageAttachments(message.payload),
    messageId: message.id,
    recipients: {
      bcc: readHeader("Bcc"),
      cc: readHeader("Cc"),
      to: readHeader("To"),
    },
    replyContext: message.threadId
      ? {
          messageHeaderId: inReplyTo || undefined,
          references,
          threadId: message.threadId,
        }
      : null,
    subject: readHeader("Subject"),
  };
};
