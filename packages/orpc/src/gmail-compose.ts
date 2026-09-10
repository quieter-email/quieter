import { ORPCError } from "@orpc/server";
import {
  createDraft,
  getDraft,
  sendDraft,
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

import {
  performGmailSubmission,
  prepareGmailSubmission,
} from "./mail-sync-submissions";

type ComposeDraftInput = z.infer<typeof composeDraftInputSchema>;
type ComposeMessageInput = z.infer<typeof composeMessageInputSchema>;

export const saveGmailDraft = async (
  accessToken: string,
  draft: ComposeDraftInput,
  owner: { mailboxId: string; userId: string },
  signal?: AbortSignal
) => {
  const submission = await prepareGmailSubmission(owner, draft, "draft");
  const raw = Buffer.from(
    await buildMimeMessage(draft, {
      includeQuieterDraftHeaders: true,
      messageId: `<quieter-${submission.recoveryKey}@sync.quieter.email>`,
    })
  ).toString("base64url");
  const response = await performGmailSubmission(
    submission,
    accessToken,
    async () => {
      if (draft.draftId && draft.baseVersion !== undefined) {
        const current = await getDraft(accessToken, draft.draftId, signal);
        if (current.message?.id !== draft.baseVersion) {
          throw new ORPCError("CONFLICT", {
            message:
              "This draft changed elsewhere. Your edits are kept here. Save a copy to keep both versions.",
          });
        }
      }
      const saved = draft.draftId
        ? await updateDraft(
            accessToken,
            draft.draftId,
            raw,
            draft.replyContext?.threadId,
            signal
          )
        : await createDraft(
            accessToken,
            raw,
            draft.replyContext?.threadId,
            signal
          );
      if (saved.message === undefined) {
        throw new Error("Draft save returned no message receipt.");
      }
      return {
        id: saved.id,
        messageId: saved.message.id,
        threadId: saved.message.threadId,
      };
    }
  );
  const savedDraft = await getDraft(accessToken, response.id, signal);
  if (
    response.messageId !== undefined &&
    savedDraft.message?.id !== response.messageId
  ) {
    throw new ORPCError("CONFLICT", {
      message:
        "This draft changed after it was saved. Your edits are kept here. Reopen the draft or save a copy.",
    });
  }
  const parsed = parseDraftMessage(savedDraft);

  return {
    attachments: [
      ...parsed.attachments,
      ...parsed.inlineImages.map((attachment) => ({
        ...attachment,
        inline: true,
      })),
    ],
    bodyHtml: parsed.bodyHtml || draft.bodyHtml,
    bodyText: parsed.bodyText || draft.bodyText,
    draftAnchor: parsed.draftAnchor ?? draft.draftAnchor ?? null,
    draftId: savedDraft.id,
    draftVersion: savedDraft.message?.id,
    messageId: savedDraft.message?.id ?? response.messageId ?? parsed.messageId,
    recipients: {
      bcc: parsed.recipients.bcc || draft.recipients.bcc,
      cc: parsed.recipients.cc || draft.recipients.cc,
      to: parsed.recipients.to || draft.recipients.to,
    },
    replyContext: parsed.replyContext ?? draft.replyContext ?? null,
    subject: parsed.subject || draft.subject,
    threadId: savedDraft.message?.threadId,
  };
};

export const sendGmailMessage = async (
  accessToken: string,
  message: ComposeMessageInput,
  owner: { mailboxId: string; userId: string },
  signal?: AbortSignal
): Promise<GmailMessage & { draftCleanupHandled: true }> => {
  const submission = await prepareGmailSubmission(owner, message, "send");
  const raw = Buffer.from(
    await buildMimeMessage(message, {
      messageId: `<quieter-${submission.recoveryKey}@sync.quieter.email>`,
    })
  ).toString("base64url");
  const result = await performGmailSubmission(
    submission,
    accessToken,
    async () => {
      if (
        message.draftId &&
        (message.baseVersion === null || message.baseVersion === undefined)
      ) {
        throw new ORPCError("CONFLICT", {
          message:
            "Reopen this draft before sending so its latest version can be checked.",
        });
      }
      if (message.draftId && message.baseVersion !== undefined) {
        const current = await getDraft(accessToken, message.draftId, signal);
        if (current.message?.id !== message.baseVersion) {
          throw new ORPCError("CONFLICT", {
            message:
              "This draft changed elsewhere. Reopen it or save a copy before sending.",
          });
        }
      }
      const sent = message.draftId
        ? await sendDraft(
            accessToken,
            message.draftId,
            raw,
            message.replyContext?.threadId,
            signal
          )
        : await sendRawMessage(
            accessToken,
            raw,
            message.replyContext?.threadId,
            signal
          );
      return { id: sent.id, threadId: sent.threadId };
    }
  );
  return { ...result, draftCleanupHandled: true };
};
