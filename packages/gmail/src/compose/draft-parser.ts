import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose";
import {
  extractInlineMessageAttachments,
  extractMessageAttachments,
  extractMessageContent,
} from "@quieter/mail/message-content";
import type { GmailDraft } from "../service";

export const parseDraftMessage = (draft: GmailDraft) => {
  const message = draft.message;
  if (!message) {
    return {
      subject: "",
      bodyHtml: "",
      bodyText: "",
      recipients: {
        to: "",
        cc: "",
        bcc: "",
      },
      draftAnchor: null,
      messageId: null,
      replyContext: null,
      attachments: [],
      inReplyTo: null,
      inlineImages: [],
    };
  }

  const content = extractMessageContent(message.payload);
  const headers = message.payload?.headers ?? [];
  const readHeader = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? "";
  const draftAnchor = parseDraftAnchorFromHeaderReader(readHeader) ?? null;
  const inReplyTo = readHeader("In-Reply-To").trim();
  const references = Array.from(new Set(readHeader("References").match(/<[^>]+>/g) ?? []));

  return {
    subject: readHeader("Subject"),
    bodyHtml: content.html ?? "",
    bodyText: content.text ?? "",
    recipients: {
      to: readHeader("To"),
      cc: readHeader("Cc"),
      bcc: readHeader("Bcc"),
    },
    draftAnchor,
    messageId: message.id,
    replyContext: message.threadId
      ? {
          threadId: message.threadId,
          messageHeaderId: inReplyTo || undefined,
          references,
        }
      : null,
    attachments: extractMessageAttachments(message.payload),
    inReplyTo: inReplyTo || null,
    inlineImages: extractInlineMessageAttachments(message.payload),
  };
};
