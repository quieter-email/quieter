import {
  createDraft,
  getDraft,
  sendRawMessage,
  updateDraft,
} from "@quieter/gmail";
import type { GmailMessage } from "@quieter/gmail";
import { parseDraftMessage } from "@quieter/gmail/compose";
import { buildMimeMessage } from "@quieter/mail/compose/mime";
import type {
  composeDraftInputSchema,
  composeMessageInputSchema,
} from "@quieter/mail/compose/schema";
import type { z } from "zod";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

export const saveGmailDraft = async (
  accessToken: string,
  draft: ComposeDraftInput,
  signal?: AbortSignal
) => {
  const raw = Buffer.from(
    await buildMimeMessage(draft, { includeQuieterDraftHeaders: true })
  ).toString("base64url");
  const response = draft.draftId
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
    bodyHtml: parsed.bodyHtml || draft.bodyHtml,
    bodyText: parsed.bodyText || draft.bodyText,
    draftAnchor: parsed.draftAnchor ?? draft.draftAnchor ?? null,
    draftId: savedDraft.id,
    messageId:
      savedDraft.message?.id ?? response.message?.id ?? parsed.messageId,
    recipients: {
      bcc: parsed.recipients.bcc || draft.recipients.bcc,
      cc: parsed.recipients.cc || draft.recipients.cc,
      to: parsed.recipients.to || draft.recipients.to,
    },
    replyContext: parsed.replyContext ?? draft.replyContext ?? null,
    subject: parsed.subject || draft.subject,
  };
};

export const sendGmailMessage = async (
  accessToken: string,
  message: ComposeMessageInput,
  signal?: AbortSignal
): Promise<GmailMessage> => {
  const raw = Buffer.from(await buildMimeMessage(message)).toString(
    "base64url"
  );
  return await sendRawMessage(
    accessToken,
    raw,
    message.replyContext?.threadId,
    signal
  );
};
