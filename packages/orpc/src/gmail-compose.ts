import {
  createDraft,
  getDraft,
  sendRawMessage,
  updateDraft,
} from "@quieter/gmail";
import type { GmailMessage } from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import {
  arrayBufferToBase64Url,
  buildMimeMessage,
} from "@quieter/mail/compose/mime";
import type {
  composeDraftInputSchema,
  composeMessageInputSchema,
} from "@quieter/mail/compose/schema";
import type { z } from "zod";

import { hasText } from "./text";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

export type ChatComposeMessage = {
  bcc: string;
  bodyText: string;
  cc: string;
  subject: string;
  to: string;
};

export const toChatComposeInput = (
  message: ChatComposeMessage
): ComposeMessageInput => ({
  attachments: [],
  // The MIME builder substitutes an empty alternative with "<p></p>", which
  // HTML-preferring clients would render as a blank email.
  bodyHtml: `<p>${message.bodyText
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>")}</p>`,
  bodyText: message.bodyText,
  inlineImages: [],
  localId: crypto.randomUUID(),
  recipients: {
    bcc: message.bcc,
    cc: message.cc,
    to: message.to,
  },
  saveStatus: "saved",
  subject: message.subject,
  updatedAt: Date.now(),
});

export const saveGmailDraft = async (
  accessToken: string,
  draft: ComposeDraftInput,
  signal?: AbortSignal
) => {
  const raw = arrayBufferToBase64Url(
    new TextEncoder().encode(
      await buildMimeMessage(draft, { includeQuieterDraftHeaders: true })
    )
  );
  const response = hasText(draft.draftId)
    ? await updateDraft(
        accessToken,
        draft.draftId,
        raw,
        draft.replyContext?.threadId,
        signal
      )
    : await createDraft(accessToken, raw, draft.replyContext?.threadId, signal);
  const savedDraft = await getDraft(accessToken, response.id, signal);
  const parsed = parseDraftMessage(savedDraft);

  return {
    bodyHtml: hasText(parsed.bodyHtml) ? parsed.bodyHtml : draft.bodyHtml,
    bodyText: hasText(parsed.bodyText) ? parsed.bodyText : draft.bodyText,
    draftAnchor: parsed.draftAnchor ?? draft.draftAnchor ?? null,
    draftId: savedDraft.id,
    messageId:
      savedDraft.message?.id ?? response.message?.id ?? parsed.messageId,
    recipients: {
      bcc: hasText(parsed.recipients.bcc)
        ? parsed.recipients.bcc
        : draft.recipients.bcc,
      cc: hasText(parsed.recipients.cc)
        ? parsed.recipients.cc
        : draft.recipients.cc,
      to: hasText(parsed.recipients.to)
        ? parsed.recipients.to
        : draft.recipients.to,
    },
    replyContext: parsed.replyContext ?? draft.replyContext ?? null,
    subject: hasText(parsed.subject) ? parsed.subject : draft.subject,
  };
};

export const sendGmailMessage = async (
  accessToken: string,
  message: ComposeMessageInput,
  signal?: AbortSignal
): Promise<GmailMessage> => {
  const raw = arrayBufferToBase64Url(
    new TextEncoder().encode(await buildMimeMessage(message))
  );
  return await sendRawMessage(
    accessToken,
    raw,
    message.replyContext?.threadId,
    signal
  );
};
