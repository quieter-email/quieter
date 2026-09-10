import { ORPCError } from "@orpc/server";
import {
  createDraft,
  deleteDraft,
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
  sendDraft as sendGmailDraft,
  sendRawMessage,
} from "@quieter/gmail";
import {
  buildMimeMessage,
  buildPlainTextMessage,
} from "@quieter/mail/compose/mime";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";

import { saveGmailDraft, sendGmailMessage } from "../gmail-compose";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  saveManagedDraft,
  deleteManagedDraft,
} from "../managed-mail/messages/drafts";
import { sendManagedMailboxMessage } from "../managed-mail/messages/send";
import { learnAiMemoryFromSentMessage } from "./feedback";
import type { MailInputs } from "./inputs";

const parseListUnsubscribeMailto = (value: string) => {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  if (url.protocol !== "mailto:") {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  const recipients = [
    ...new Set([
      ...splitMailAddressList(decodeURIComponent(url.pathname)),
      ...splitMailAddressList(url.searchParams.get("to") ?? ""),
    ]),
  ];

  if (recipients.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }

  return {
    body: url.searchParams.get("body") ?? "",
    subject: url.searchParams.get("subject") ?? "",
    to: recipients.join(", "),
  };
};

export const composeMailOperations = {
  deleteDraft: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["deleteDraft"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await deleteManagedDraft({
        ...input,
        userId: context.userId,
      });
    }

    return await callGmail(context, input.mailboxId, async (accessToken) => {
      await deleteDraft(accessToken, input.draftId);
      return { deleted: true };
    });
  },
  saveDraft: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["saveDraft"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await saveManagedDraft({
        ...input,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await saveGmailDraft(accessToken, input.draft, context.signal)
    );
  },
  sendDraft: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["sendDraft"];
  }) =>
    await callGmail(context, input.mailboxId, async (accessToken) => {
      const raw = Buffer.from(await buildMimeMessage(input.draft)).toString(
        "base64url"
      );
      let draftId = input.draft.draftId ?? null;
      if (draftId === null || draftId.length === 0) {
        const savedDraft = await createDraft(
          accessToken,
          raw,
          input.draft.replyContext?.threadId
        );
        draftId = savedDraft.id;
      }

      if (draftId === null || draftId.length === 0) {
        throw new ORPCError("INTERNAL_SERVER_ERROR", {
          message: "Draft could not be saved before send.",
        });
      }

      const sent = await sendGmailDraft(
        accessToken,
        draftId,
        raw,
        input.draft.replyContext?.threadId
      );
      await learnAiMemoryFromSentMessage({
        bodyText: input.draft.bodyText,
        isReply: !!input.draft.replyContext,
        mailboxId: input.mailboxId,
        recipients: [
          input.draft.recipients.to,
          input.draft.recipients.cc,
          input.draft.recipients.bcc,
        ].join(","),
        userId: context.userId,
      }).catch((error: unknown) => {
        reportError(error, {
          operation: "Could not record sent-message learning.",
        });
      });
      return sent;
    }),
  sendMessage: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["sendMessage"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      const sent = await sendManagedMailboxMessage({
        ...input,
        userId: context.userId,
      });
      await learnAiMemoryFromSentMessage({
        bodyText: input.message.bodyText,
        isReply: !!input.message.replyContext,
        mailboxId: input.mailboxId,
        recipients: [
          input.message.recipients.to,
          input.message.recipients.cc,
          input.message.recipients.bcc,
        ].join(","),
        userId: context.userId,
      }).catch((error: unknown) => {
        reportError(error, {
          operation: "Could not record sent-message learning.",
        });
      });
      return sent;
    }

    return await callGmail(context, input.mailboxId, async (accessToken) => {
      const sent = await sendGmailMessage(
        accessToken,
        input.message,
        context.signal
      );
      await learnAiMemoryFromSentMessage({
        bodyText: input.message.bodyText,
        isReply: !!input.message.replyContext,
        mailboxId: input.mailboxId,
        recipients: [
          input.message.recipients.to,
          input.message.recipients.cc,
          input.message.recipients.bcc,
        ].join(","),
        userId: context.userId,
      }).catch((error: unknown) => {
        reportError(error, {
          operation: "Could not record sent-message learning.",
        });
      });
      return sent;
    });
  },
  unsubscribeFromMessage: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["unsubscribeFromMessage"];
  }) =>
    await callGmail(context, input.mailboxId, async (accessToken, signal) => {
      const message = await getGmailMessageMetadata(
        accessToken,
        input.messageId,
        signal
      );
      const unsubscribeMailto = extractListUnsubscribeTargets(
        message.payload?.headers?.find(
          (header) => header.name.toLowerCase() === "list-unsubscribe"
        )?.value
      ).mailto;

      if (unsubscribeMailto === undefined || unsubscribeMailto.length === 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: "This message does not expose a valid unsubscribe address.",
        });
      }

      const raw = Buffer.from(
        await buildPlainTextMessage(
          parseListUnsubscribeMailto(unsubscribeMailto)
        )
      ).toString("base64url");

      await sendRawMessage(accessToken, raw);

      return { sent: true };
    }),
};
