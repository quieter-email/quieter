import {
  createDraft,
  getDraft,
  sendRawMessage,
  updateDraft,
  type GmailMessage,
} from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import {
  arrayBufferToBase64Url,
  buildMimeMessage,
  composeDraftInputSchema,
  composeMessageInputSchema,
} from "@quieter/mail/compose";
import { z } from "zod";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

export const saveGmailDraft = async (
  accessToken: string,
  draft: ComposeDraftInput,
  signal?: AbortSignal,
) => {
  const raw = arrayBufferToBase64Url(
    new TextEncoder().encode(await buildMimeMessage(draft, { includeQuieterDraftHeaders: true })),
  );
  const response = draft.draftId
    ? await updateDraft(accessToken, draft.draftId, raw, draft.replyContext?.threadId, signal)
    : await createDraft(accessToken, raw, draft.replyContext?.threadId, signal);
  const savedDraft = await getDraft(accessToken, response.id, signal);
  const parsed = parseDraftMessage(savedDraft);

  return {
    draftId: savedDraft.id,
    draftAnchor: parsed.draftAnchor ?? draft.draftAnchor ?? null,
    messageId: savedDraft.message?.id ?? response.message?.id ?? parsed.messageId,
    bodyHtml: parsed.bodyHtml || draft.bodyHtml,
    bodyText: parsed.bodyText || draft.bodyText,
    replyContext: parsed.replyContext ?? draft.replyContext ?? null,
    subject: parsed.subject || draft.subject,
    recipients: {
      to: parsed.recipients.to || draft.recipients.to,
      cc: parsed.recipients.cc || draft.recipients.cc,
      bcc: parsed.recipients.bcc || draft.recipients.bcc,
    },
  };
};

export const sendGmailMessage = async (
  accessToken: string,
  message: ComposeMessageInput,
  signal?: AbortSignal,
): Promise<GmailMessage> => {
  const raw = arrayBufferToBase64Url(new TextEncoder().encode(await buildMimeMessage(message)));
  return await sendRawMessage(accessToken, raw, message.replyContext?.threadId, signal);
};
