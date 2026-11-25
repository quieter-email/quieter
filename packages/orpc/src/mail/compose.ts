import { ORPCError } from "@orpc/server";
import { db } from "@quieter/database/client";
import { organizationMailSendIdempotency } from "@quieter/database/schema";
import {
  extractListUnsubscribeTargets,
  getGmailMessageMetadata,
} from "@quieter/gmail";
import {
  findInvalidMailAddresses,
  splitMailAddressList,
} from "@quieter/mail/compose/schema";
import { getUnsubscribeKey } from "@quieter/mail/unsubscribe";
import { reportError } from "@quieter/observability";
import { and, eq, sql } from "drizzle-orm";

import {
  captureMailboxDraftMemory,
  captureMailboxMessageMemory,
} from "../ai-memory-capture";
import {
  deleteGmailComposeDraft,
  getGmailComposeSendStatus,
  saveGmailDraft,
  sendGmailMessage,
  sendGmailUnsubscribe,
} from "../gmail-compose";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertOwnedGmailMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  saveManagedDraft,
  deleteManagedDraft,
} from "../managed-mail/messages/drafts";
import { sendManagedMailboxMessage } from "../managed-mail/messages/send";
import { saveDraftReminderIntent } from "../reminders/draft-state";
import { hashRequest } from "../request-hash";
import {
  assertComposeNotScheduled,
  assertComposeSendAttemptActive,
  resolveComposeSourceDraftId,
} from "../scheduled-send/reservation";
import { withMailComposeLock } from "./compose-lock";
import { learnAiMemoryFromMailAction } from "./feedback";
import type { MailInputs } from "./inputs";

const parseListUnsubscribeMailto = (value: string) => {
  let url: URL;
  let path: string;

  try {
    url = new URL(value);
    path = decodeURIComponent(url.pathname);
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
      ...splitMailAddressList(path),
      ...splitMailAddressList(url.searchParams.get("to") ?? ""),
    ]),
  ];

  if (
    recipients.length === 0 ||
    recipients.some(
      (recipient) => findInvalidMailAddresses(recipient).length > 0
    )
  ) {
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

const resolveUnsubscribeMessage = async (
  accessToken: string,
  messageId: string,
  signal?: AbortSignal
) => {
  const message = await getGmailMessageMetadata(accessToken, messageId, signal);
  const headers = message.payload?.headers ?? [];
  const unsubscribeMailto = extractListUnsubscribeTargets(
    headers.find((header) => header.name.toLowerCase() === "list-unsubscribe")
      ?.value
  ).mailto;
  if (unsubscribeMailto === undefined || unsubscribeMailto.length === 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not expose a valid unsubscribe address.",
    });
  }
  const key = getUnsubscribeKey(headers);
  if (key === undefined) {
    throw new ORPCError("BAD_REQUEST", {
      message: "This message does not identify a mailing list or sender.",
    });
  }
  const outbound = parseListUnsubscribeMailto(unsubscribeMailto);
  return {
    headers,
    key,
    outbound,
    requestHash: hashRequest({ key, outbound }),
  };
};

export const composeMailOperations = {
  deleteDraft: async ({
    context,
    input,
    requireExistingDraft = false,
  }: {
    context: MailRequestContext;
    input: MailInputs["deleteDraft"];
    requireExistingDraft?: boolean;
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (selectedMailbox.provider === "managed") {
      return await deleteManagedDraft({
        ...input,
        requireExisting: requireExistingDraft,
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
          { ...input, requireExisting: requireExistingDraft },
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
      return {
        definitiveRejection: operation?.status === "rejected",
        status: "rejected" as const,
      };
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
  previewUnsubscribe: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["unsubscribeFromMessage"];
  }) => {
    const mailbox = await assertOwnedGmailMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal) => {
        const { outbound, requestHash } = await resolveUnsubscribeMessage(
          accessToken,
          input.messageId,
          signal
        );
        return { ...outbound, from: mailbox.emailAddress, requestHash };
      }
    );
  },
  saveDraft: async ({
    context,
    input,
    privateContext = false,
  }: {
    context: MailRequestContext;
    privateContext?: boolean;
    input: MailInputs["saveDraft"];
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (!selectedMailbox.capabilities.canSend) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to send from this mailbox.",
      });
    }
    const sourceDraftId = await resolveComposeSourceDraftId({
      ...input.draft,
      mailboxId: input.mailboxId,
      provider: selectedMailbox.provider,
    });
    return await withMailComposeLock(
      input.mailboxId,
      `source:${sourceDraftId ?? input.draft.localId}`,
      async () => {
        await assertComposeNotScheduled({
          ...input.draft,
          draftId: sourceDraftId,
          mailboxId: input.mailboxId,
          scheduledSendId: undefined,
        });
        if (selectedMailbox.provider === "managed") {
          const saved = await saveManagedDraft({
            ...input,
            privateContext,
            userId: context.userId,
          });
          await saveDraftReminderIntent({
            draftId: saved.draftId,
            intent: input.draft.followUpReminder,
            mailboxId: input.mailboxId,
            userId: context.userId,
          });
          await captureMailboxDraftMemory({
            draft: input.draft,
            draftId: saved.draftId,
            mailboxId: input.mailboxId,
            userId: context.userId,
          });
          return {
            ...saved,
            ...(input.draft.followUpReminder === undefined
              ? {}
              : { followUpReminder: input.draft.followUpReminder }),
          };
        }

        return await callGmail(
          context,
          input.mailboxId,
          async (accessToken) => {
            const saved = await saveGmailDraft(
              accessToken,
              input.mailboxId,
              input.draft,
              context.signal
            );
            await saveDraftReminderIntent({
              draftId: saved.draftId,
              intent: input.draft.followUpReminder,
              mailboxId: input.mailboxId,
              userId: context.userId,
            });
            await captureMailboxDraftMemory({
              draft: input.draft,
              draftId: saved.draftId,
              mailboxId: input.mailboxId,
              userId: context.userId,
            });
            return {
              ...saved,
              ...(input.draft.followUpReminder === undefined
                ? {}
                : { followUpReminder: input.draft.followUpReminder }),
            };
          }
        );
      }
    );
  },
  sendMessage: async ({
    context,
    input,
    scheduledSendId,
  }: {
    context: MailRequestContext;
    input: MailInputs["sendMessage"];
    scheduledSendId?: string;
  }) => {
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (!selectedMailbox.capabilities.canSend) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to send from this mailbox.",
      });
    }
    const sourceDraftId = await resolveComposeSourceDraftId({
      ...input.message,
      mailboxId: input.mailboxId,
      provider: selectedMailbox.provider,
    });
    return await withMailComposeLock(
      input.mailboxId,
      `source:${sourceDraftId ?? input.message.localId}`,
      async () => {
        await assertComposeSendAttemptActive({
          mailboxId: input.mailboxId,
          scheduledSendId,
          sendOperationId:
            input.message.sendOperationId ?? input.message.localId,
          userId: context.userId,
        });
        await assertComposeNotScheduled({
          ...input.message,
          draftId: sourceDraftId,
          mailboxId: input.mailboxId,
          scheduledSendId,
        });
        if (selectedMailbox.provider === "managed") {
          return await sendManagedMailboxMessage({
            ...input,
            userId: context.userId,
          });
        }

        return await callGmail(
          context,
          input.mailboxId,
          async (accessToken) => {
            const sent = await sendGmailMessage(
              accessToken,
              input.mailboxId,
              input.message,
              context.signal,
              selectedMailbox.organizationId,
              context.userId
            );
            await captureMailboxMessageMemory({
              actorUserId: context.userId,
              mailboxId: input.mailboxId,
              message: {
                bcc: input.message.recipients.bcc,
                bodyHtml: input.message.bodyHtml,
                bodyText: input.message.bodyText,
                cc: input.message.recipients.cc,
                date: new Date().toISOString(),
                id: sent.id,
                inReplyTo: input.message.replyContext?.messageHeaderId,
                subject: input.message.subject,
                threadId: sent.threadId ?? sent.id,
                to: input.message.recipients.to,
              },
              source: "sent",
            }).catch((error: unknown) => {
              reportError(error, {
                operation: "Could not record sent-message learning.",
              });
            });
            return sent;
          },
          { kind: "send" }
        );
      }
    );
  },
  unsubscribeFromMessage: async ({
    context,
    input,
  }: {
    context: MailRequestContext;
    input: MailInputs["unsubscribeFromMessage"];
  }) =>
    await callGmail(context, input.mailboxId, async (accessToken, signal) => {
      const { headers, key, outbound, requestHash } =
        await resolveUnsubscribeMessage(accessToken, input.messageId, signal);
      if (
        input.expectedRequestHash !== undefined &&
        input.expectedRequestHash !== requestHash
      ) {
        throw new ORPCError("CONFLICT", {
          message:
            "The unsubscribe message changed. Review it again before sending.",
        });
      }
      const result = await sendGmailUnsubscribe(
        accessToken,
        input.mailboxId,
        {
          key,
          message: outbound,
        },
        signal
      );

      if (!result.idempotent) {
        await learnAiMemoryFromMailAction({
          action: "unsubscribe",
          mailboxId: input.mailboxId,
          metadata: {
            senderDomain:
              headers
                .find((header) => header.name.toLowerCase() === "from")
                ?.value.match(/@(?<domain>[a-z0-9.-]+\.[a-z]{2,})/iu)
                ?.groups?.domain?.toLowerCase() ?? null,
            subject:
              headers.find((header) => header.name.toLowerCase() === "subject")
                ?.value ?? null,
          },
          targetCount: 1,
          userId: context.userId,
        }).catch((error: unknown) => {
          reportError(error, {
            operation: "Could not record unsubscribe learning.",
          });
        });
      }
      return {
        key,
        newlyRequested: !result.idempotent,
        status: "requested" as const,
      };
    }),
};
