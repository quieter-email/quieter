import { db } from "@quieter/database/client";
import { managedMailMessage } from "@quieter/database/schema";
import { getGmailTargetLabelState, isGmailServiceError } from "@quieter/gmail";
import { MAILBOX_LABELS } from "@quieter/mail/messages";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import {
  decryptSecret,
  loadOwnedGmailCredential,
  REQUIRED_GMAIL_SCOPES,
} from "../gmail-mailbox-access";
import { callGmail } from "../gmail-request";
import type { MailRequestContext } from "../gmail-request";
import { getAuthorizedManagedMailbox } from "../mailbox/access";
import { assertAccessibleMailbox } from "../mailbox/service";
import { getManagedMessageCategoryCondition } from "../managed-mail/messages/service";

type NotificationGmailCredential = Readonly<
  Awaited<ReturnType<typeof loadOwnedGmailCredential>>
>;

const matchesNotificationCredential = ({
  initial,
  current,
}: {
  initial: NotificationGmailCredential;
  current: NotificationGmailCredential;
}) => {
  const scopes = new Set(current.scopes.split(/\s+/u));
  return (
    current.id === initial.id &&
    current.userId === initial.userId &&
    current.googleSubject === initial.googleSubject &&
    current.emailAddress === initial.emailAddress &&
    current.credentialCreatedAt.getTime() ===
      initial.credentialCreatedAt.getTime() &&
    current.mailboxCreatedAt.getTime() === initial.mailboxCreatedAt.getTime() &&
    (current.encryptedRefreshToken === initial.encryptedRefreshToken ||
      (current.encryptedRefreshToken !== null &&
        initial.encryptedRefreshToken !== null &&
        decryptSecret(current.encryptedRefreshToken) ===
          decryptSecret(initial.encryptedRefreshToken))) &&
    REQUIRED_GMAIL_SCOPES.every((required) => scopes.has(required))
  );
};

export const newMailNotificationEligibilityInputSchema = z.strictObject({
  mailboxId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  threadId: z.string().trim().min(1),
});

export const newMailNotificationEligibilityOutputSchema = z.strictObject({
  eligible: z.boolean(),
});

export const getNewMailNotificationEligibility = async ({
  context,
  input,
}: {
  context: MailRequestContext;
  input: z.infer<typeof newMailNotificationEligibilityInputSchema>;
}): Promise<z.infer<typeof newMailNotificationEligibilityOutputSchema>> => {
  context.signal?.throwIfAborted();
  const scope = { mailboxId: input.mailboxId, userId: context.userId };
  const selectedMailbox = await assertAccessibleMailbox(scope);

  if (selectedMailbox.provider === "managed") {
    const inbox = getManagedMessageCategoryCondition("inbox");
    const unread = getManagedMessageCategoryCondition("unread");
    if (
      inbox === null ||
      inbox === undefined ||
      unread === null ||
      unread === undefined
    ) {
      throw new Error("Notification visibility conditions are unavailable.");
    }
    const eligible = await db.transaction(
      async (transaction) => {
        await getAuthorizedManagedMailbox(scope, transaction);
        const [message] = await transaction
          .select({ id: managedMailMessage.id })
          .from(managedMailMessage)
          .where(
            and(
              eq(managedMailMessage.mailboxId, input.mailboxId),
              eq(managedMailMessage.threadId, input.threadId),
              eq(managedMailMessage.id, input.messageId),
              inbox,
              unread
            )
          )
          .limit(1);
        return message !== undefined;
      },
      { accessMode: "read only", isolationLevel: "repeatable read" }
    );
    await getAuthorizedManagedMailbox(scope);
    context.signal?.throwIfAborted();
    return { eligible };
  }

  const initial = await loadOwnedGmailCredential(scope);
  let observation: {
    accessToken: string;
    mailbox: NotificationGmailCredential;
    thread: Awaited<ReturnType<typeof getGmailTargetLabelState>>;
  } | null = null;
  try {
    observation = await callGmail(
      context,
      input.mailboxId,
      async (accessToken, signal, authorizedMailbox) => {
        if (authorizedMailbox === undefined) {
          throw new Error("Prepared mailbox identity is unavailable.");
        }
        const current = await loadOwnedGmailCredential(scope);
        context.signal?.throwIfAborted();
        if (
          current.status !== "connected" ||
          ![initial, authorizedMailbox, current].every((record) =>
            matchesNotificationCredential({ current: record, initial })
          ) ||
          current.encryptedAccessToken === null ||
          decryptSecret(current.encryptedAccessToken) !== accessToken
        ) {
          return null;
        }
        return {
          accessToken,
          mailbox: authorizedMailbox,
          thread: await getGmailTargetLabelState(accessToken, {
            id: input.threadId,
            signal,
            target: "thread",
          }),
        };
      }
    );
  } catch (error) {
    if (!isGmailServiceError(error) || error.status !== 404) {
      throw error;
    }
  }

  const current = await loadOwnedGmailCredential(scope);
  context.signal?.throwIfAborted();
  if (observation === null) {
    return { eligible: false };
  }
  const { thread } = observation;
  const message = thread.messages.find((item) => item.id === input.messageId);
  const labels = new Set(message?.labelIds);
  return {
    eligible:
      thread.id === input.threadId &&
      message !== undefined &&
      labels.has(MAILBOX_LABELS.inbox) &&
      labels.has(MAILBOX_LABELS.unread) &&
      ![
        MAILBOX_LABELS.sent,
        MAILBOX_LABELS.drafts,
        MAILBOX_LABELS.spam,
        MAILBOX_LABELS.trash,
      ].some((label) => labels.has(label)) &&
      current.status === "connected" &&
      [initial, observation.mailbox, current].every((record) =>
        matchesNotificationCredential({ current: record, initial })
      ) &&
      current.encryptedAccessToken !== null &&
      decryptSecret(current.encryptedAccessToken) === observation.accessToken,
  };
};
