import { ORPCError } from "@orpc/server";
import {
  deleteDraft,
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
  getDraft,
  sendRawMessage,
} from "@quieter/gmail";
import { buildPlainTextMessage } from "@quieter/mail/compose/mime";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";

import { saveGmailDraft, sendGmailMessage } from "../gmail-compose";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { withGmailComposeReplication } from "../mail-sync-compose";
import { isMailSyncEnabled } from "../mail-sync-runtime";
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

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await withGmailComposeReplication(
          input.mailboxId,
          accessToken,
          async () => {
            const draft = await getDraft(
              accessToken,
              input.draftId,
              context.signal
            );
            if (
              input.baseVersion !== undefined &&
              draft.message?.id !== input.baseVersion
            ) {
              throw new ORPCError("CONFLICT", {
                message:
                  "This draft changed elsewhere and was kept. Reopen it before deleting it.",
              });
            }
            await deleteDraft(accessToken, input.draftId);
            return {
              result: { deleted: true },
              threadIds: draft.message?.threadId
                ? [draft.message.threadId]
                : [],
            };
          }
        )
    );
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
        await withGmailComposeReplication(
          input.mailboxId,
          accessToken,
          async () => {
            if (
              isMailSyncEnabled() &&
              input.draft.draftId &&
              (input.draft.baseVersion === null ||
                input.draft.baseVersion === undefined)
            ) {
              throw new ORPCError("CONFLICT", {
                message:
                  "Reopen this draft before saving. Your edits are kept here, or you can save a copy.",
              });
            }
            const result = await saveGmailDraft(
              accessToken,
              input.draft,
              { mailboxId: input.mailboxId, userId: context.userId },
              context.signal
            );
            return {
              result,
              threadIds: result.threadId ? [result.threadId] : [],
            };
          }
        )
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
      const sent = await withGmailComposeReplication(
        input.mailboxId,
        accessToken,
        async () => {
          const result = await sendGmailMessage(
            accessToken,
            input.draft,
            { mailboxId: input.mailboxId, userId: context.userId },
            context.signal
          );
          return { result, threadIds: [result.threadId] };
        }
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
      const sent = await withGmailComposeReplication(
        input.mailboxId,
        accessToken,
        async () => {
          const result = await sendGmailMessage(
            accessToken,
            input.message,
            { mailboxId: input.mailboxId, userId: context.userId },
            context.signal
          );
          return { result, threadIds: [result.threadId] };
        }
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
