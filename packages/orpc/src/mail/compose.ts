import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { organizationMailSendIdempotency } from "@quieter/database/schema";
import {
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
  sendRawMessage,
} from "@quieter/gmail";
import { buildPlainTextMessage } from "@quieter/mail/compose/mime";
import { splitMailAddressList } from "@quieter/mail/compose/schema";
import { reportError } from "@quieter/observability";
import { and, eq, sql } from "drizzle-orm";

import {
  deleteGmailComposeDraft,
  getGmailComposeSendStatus,
  saveGmailDraft,
  sendGmailMessage,
} from "../gmail-compose";
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

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken) =>
        await deleteGmailComposeDraft(
          accessToken,
          input.mailboxId,
          input,
          context.signal
        )
    );
  },
  getComposeSendStatus: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: {
      mailboxId: string;
      sendOperationId: string;
    };
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider !== "managed") {
      return await callGmail(
        context,
        input.mailboxId,
        async (accessToken) =>
          await getGmailComposeSendStatus(
            accessToken,
            input.mailboxId,
            input,
            context.signal
          )
      );
    }
    const [operation] = await db
      .select()
      .from(organizationMailSendIdempotency)
      .where(
        and(
          eq(
            organizationMailSendIdempotency.organizationId,
            selectedMailbox.organizationId ?? ""
          ),
          sql`${organizationMailSendIdempotency.snapshot}->>'mailboxId' = ${input.mailboxId}`,
          eq(
            organizationMailSendIdempotency.idempotencyKey,
            `compose:${input.mailboxId}:${input.sendOperationId}`
          )
        )
      )
      .limit(1);
    if (
      operation === undefined ||
      operation.status === "rejected" ||
      operation.status === "prepared" ||
      operation.status === "pending"
    ) {
      return { status: "rejected" as const };
    }
    if (
      (operation.status === "accepted" || operation.status === "completed") &&
      operation.response
    ) {
      return {
        id: operation.id,
        messageId: operation.response.messageId ?? undefined,
        status: "sent" as const,
        threadId: operation.snapshot?.threadId ?? operation.id,
      };
    }
    return { status: "pending" as const };
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
        await saveGmailDraft(
          accessToken,
          input.mailboxId,
          input.draft,
          context.signal
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
    await composeMailOperations.sendMessage({
      context,
      input: { mailboxId: input.mailboxId, message: input.draft },
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
        input.mailboxId,
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
