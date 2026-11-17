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
import { assertMailWriteAccess, callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { assertAccessibleMailbox } from "../mailbox/service";
import {
  saveManagedDraft,
  deleteManagedDraft,
} from "../managed-mail/messages/drafts";
import { sendManagedMailboxMessage } from "../managed-mail/messages/send";
import { saveDraftReminderIntent } from "../reminders/draft-state";
import {
  assertComposeNotScheduled,
  assertComposeSendAttemptActive,
  resolveComposeSourceDraftId,
} from "../scheduled-send/reservation";
import { withMailComposeLock } from "./compose-lock";
import { learnAiMemoryFromMailAction } from "./feedback";
import type { MailInputs } from "./inputs";
import { captureMailSendIntentAuthority } from "./intent-authority";
import type { MailSendIntentAuthority } from "./intent-authority";
import { assertComposeSnippetFieldsResolved } from "./snippet-quote-provenance";

const saveDraftMetadata = async (input: {
  context: MailRequestContext;
  draft: MailInputs["saveDraft"]["draft"];
  draftId: string;
  learningOrigin: MailSendIntentAuthority["learning"];
  mailboxId: string;
}) => {
  let reminderSaved = false;
  try {
    await saveDraftReminderIntent({
      beforeEffect: async (database) => {
        await input.context.beforeEffect?.(database);
        await assertMailWriteAccess(
          {
            gmailIdentity: input.context.gmailIdentity,
            mailboxId: input.mailboxId,
            userId: input.context.userId,
          },
          database
        );
      },
      draftId: input.draftId,
      intent: input.draft.followUpReminder,
      mailboxId: input.mailboxId,
      origin: input.context.origin,
      userId: input.context.userId,
    });
    reminderSaved = true;
  } catch (error) {
    const data: unknown = error instanceof ORPCError ? error.data : undefined;
    const expectedAbort = error instanceof Error && error.name === "AbortError";
    const expectedAuthorityChange =
      error instanceof ORPCError &&
      (error.code === "FORBIDDEN" ||
        error.code === "UNAUTHORIZED" ||
        error.code === "CONFLICT" ||
        error.code === "NOT_FOUND");
    if (
      !(
        typeof data === "object" &&
        data !== null &&
        "aiAuthorityReason" in data
      ) &&
      !expectedAuthorityChange &&
      !expectedAbort
    ) {
      throw error;
    }
  }
  try {
    if (input.learningOrigin !== null) {
      await captureMailboxDraftMemory({
        draft: input.draft,
        draftId: input.draftId,
        mailboxId: input.mailboxId,
        origin: input.learningOrigin,
        userId: input.context.userId,
      });
    }
  } catch (error) {
    const data: unknown = error instanceof ORPCError ? error.data : undefined;
    const expectedAbort = error instanceof Error && error.name === "AbortError";
    const expectedAuthorityChange =
      error instanceof ORPCError &&
      (error.code === "FORBIDDEN" ||
        error.code === "UNAUTHORIZED" ||
        error.code === "CONFLICT" ||
        error.code === "NOT_FOUND");
    if (
      !(
        typeof data === "object" &&
        data !== null &&
        "aiAuthorityReason" in data
      ) &&
      !expectedAuthorityChange &&
      !expectedAbort
    ) {
      throw error;
    }
  }
  return reminderSaved ? input.draft.followUpReminder : undefined;
};

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
        context,
        requireExisting: requireExistingDraft,
        userId: context.userId,
      });
    }

    return await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal, beforeEffect) =>
        await deleteGmailComposeDraft(
          accessToken,
          input.mailboxId,
          { ...input, requireExisting: requireExistingDraft },
          signal,
          beforeEffect
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
    const intentAuthority = await captureMailSendIntentAuthority({
      mailboxId: input.mailboxId,
      origin: context.origin ?? { kind: "human" },
      userId: context.userId,
    });
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
            context,
            privateContext: privateContext || context.privateContext === true,
            userId: context.userId,
          });
          const followUpReminder = await saveDraftMetadata({
            context,
            draft: input.draft,
            draftId: saved.draftId,
            learningOrigin: intentAuthority.learning,
            mailboxId: input.mailboxId,
          });
          return {
            ...saved,
            ...(followUpReminder === undefined ? {} : { followUpReminder }),
          };
        }

        return await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal, beforeEffect, gmailIdentity) => {
            const saved = await saveGmailDraft(
              accessToken,
              input.mailboxId,
              input.draft,
              signal,
              beforeEffect
            );
            const followUpReminder = await saveDraftMetadata({
              context: { ...context, gmailIdentity },
              draft: input.draft,
              draftId: saved.draftId,
              learningOrigin: intentAuthority.learning,
              mailboxId: input.mailboxId,
            });
            return {
              ...saved,
              ...(followUpReminder === undefined ? {} : { followUpReminder }),
            };
          }
        );
      }
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
    context: requestContext,
    input,
    scheduledSendId,
  }: {
    context: MailRequestContext;
    input: MailInputs["sendMessage"];
    scheduledSendId?: string;
  }) => {
    const sendOperationId =
      input.message.sendOperationId ?? input.message.localId;
    assertComposeSnippetFieldsResolved({
      actorUserId: requestContext.userId,
      mailboxId: input.mailboxId,
      message: input.message,
      sendOperationId,
      snippetQuote: requestContext.snippetQuote,
    });
    const context: MailRequestContext = {
      ...requestContext,
      beforeEffect: async (database) => {
        await requestContext.beforeEffect?.(database);
        assertComposeSnippetFieldsResolved({
          actorUserId: requestContext.userId,
          mailboxId: input.mailboxId,
          message: input.message,
          sendOperationId,
          snippetQuote: requestContext.snippetQuote,
        });
      },
    };
    const selectedMailbox = await assertAccessibleMailbox({
      mailboxId: input.mailboxId,
      userId: context.userId,
    });
    if (!selectedMailbox.capabilities.canSend) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have permission to send from this mailbox.",
      });
    }
    const intentAuthority = await captureMailSendIntentAuthority({
      mailboxId: input.mailboxId,
      origin: context.origin ?? { kind: "human" },
      userId: context.userId,
    });
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
            context,
            intentAuthority,
            userId: context.userId,
          });
        }

        return await callGmail(
          context,
          input.mailboxId,
          async (accessToken, signal, beforeEffect) => {
            const sent = await sendGmailMessage(
              accessToken,
              input.mailboxId,
              input.message,
              signal,
              selectedMailbox.organizationId,
              context.userId,
              beforeEffect,
              intentAuthority.operation
            );
            if (!sent.idempotent && intentAuthority.learning !== null) {
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
                origin: intentAuthority.learning,
                source: "sent",
              }).catch((error: unknown) => {
                reportError(error, {
                  operation: "Could not record sent-message learning.",
                });
              });
            }
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
    await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal, beforeEffect) => {
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
            message:
              "This message does not expose a valid unsubscribe address.",
          });
        }

        const key = getUnsubscribeKey(message.payload?.headers ?? []);
        if (key === undefined) {
          throw new ORPCError("BAD_REQUEST", {
            message: "This message does not identify a mailing list or sender.",
          });
        }
        const result = await sendGmailUnsubscribe(
          accessToken,
          input.mailboxId,
          {
            key,
            message: parseListUnsubscribeMailto(unsubscribeMailto),
          },
          signal,
          beforeEffect
        );

        if (!result.idempotent) {
          await learnAiMemoryFromMailAction({
            action: "unsubscribe",
            mailboxId: input.mailboxId,
            metadata: {
              senderDomain:
                message.payload?.headers
                  ?.find((header) => header.name.toLowerCase() === "from")
                  ?.value.match(/@(?<domain>[a-z0-9.-]+\.[a-z]{2,})/iu)
                  ?.groups?.domain?.toLowerCase() ?? null,
              subject:
                message.payload?.headers?.find(
                  (header) => header.name.toLowerCase() === "subject"
                )?.value ?? null,
            },
            origin: context.origin?.kind === "ai" ? context.origin : undefined,
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
      }
    ),
};
