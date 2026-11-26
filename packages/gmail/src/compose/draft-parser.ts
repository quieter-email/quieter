import { parseDraftAnchorFromHeaderReader } from "@quieter/mail/compose/draft-anchor";
import { QUIETER_DRAFT_HEADER_NAMES } from "@quieter/mail/compose/schema";
import type { ComposeDraftRecipients } from "@quieter/mail/compose/schema";
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
  options?: {
    bodyHtml?: string;
    bodyText?: string;
    restoreRecipients?: (
      sealedRecipients: string
    ) => ComposeDraftRecipients | undefined;
  }
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
  const bodyHtml = options?.bodyHtml ?? content.html ?? "";
  const bodyText = options?.bodyText ?? content.text ?? "";
  const headers = message.payload?.headers ?? [];
  const readHeader = (name: string) =>
    headers.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? "";
  const draftAnchor = parseDraftAnchorFromHeaderReader(readHeader) ?? null;
  const sealedRecipients = readHeader(QUIETER_DRAFT_HEADER_NAMES.recipients);
  const recipients = {
    bcc: decodeMimeHeaderValue(readHeader("Bcc")) ?? "",
    cc: decodeMimeHeaderValue(readHeader("Cc")) ?? "",
    to: decodeMimeHeaderValue(readHeader("To")) ?? "",
  };
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
    recipients:
      (sealedRecipients && !recipients.to && !recipients.cc && !recipients.bcc
        ? options?.restoreRecipients?.(sealedRecipients.replaceAll(/\s/gu, ""))
        : undefined) ?? recipients,
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
