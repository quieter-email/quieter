import {
  SESv2Client,
  SESv2ServiceException,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { ORPCError } from "@orpc/server";
import { reserveOrganizationMailSend } from "@quieter/billing/mail-send-reservation";
import {
  estimateOutboundOrganizationMailUsage,
  recordOrganizationMailUsage,
} from "@quieter/billing/organization-mail-usage";
import { db } from "@quieter/database/client";
import type { DatabaseTransaction } from "@quieter/database/client";
import {
  mailbox,
  managedMailMessage,
  organizationMailSendIdempotency,
} from "@quieter/database/schema";
import type { MailSendSnapshot } from "@quieter/database/schema";
import { serverEnv } from "@quieter/env/server";
import { extractMailAddress } from "@quieter/mail/compose/schema";
import type { SendMessageResult } from "@quieter/mail/send";
import { reportError } from "@quieter/observability";
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";

import { assertLocalMailSend } from "./local-managed-mail";
import { withManagedSyncTransaction } from "./mail-sync-runtime";
import { recordOutboundManagedMessageForSender } from "./managed-mail/messages/outbound";
import { readRawMailObject } from "./managed-mail/messages/raw-object";
import { storeRawMailObject } from "./managed-mail/messages/raw-object-lifecycle";
import { recordOrganizationApiMailMessage } from "./organization-api-mail";
import { assertOrganizationMailRecipientsNotSuppressed } from "./organization-mail-delivery";
import { assertOrganizationOwnsVerifiedSenderDomain } from "./organization-mail-policy";

type MailSend = typeof organizationMailSendIdempotency.$inferSelect;
const UNCERTAIN_DELIVERY_MESSAGE =
  "The delivery result is still being confirmed. Check Sent before sending again.";
let sesClient: SESv2Client | undefined;

const completeMailSend = async (operation: MailSend) => {
  const { snapshot, response } = operation;
  if (
    operation.status !== "accepted" ||
    snapshot === null ||
    response?.messageId === undefined ||
    response.messageId === null
  ) {
    return;
  }
  if (
    operation.rawObjectBucket === null ||
    operation.rawObjectKey === null ||
    operation.rawObjectProvider === null ||
    operation.messageHeaderId === null
  ) {
    throw new Error("Accepted mail send is missing its stored message.");
  }
  const rawObject = {
    bucket: operation.rawObjectBucket,
    key: operation.rawObjectKey,
    provider: operation.rawObjectProvider,
  };
  const storedAccount = snapshot.billingAccount;
  const projection = {
    ...snapshot,
    id: operation.id,
    messageHeaderId: operation.messageHeaderId,
    organizationId: operation.organizationId,
    providerMessageId: response.messageId,
    rawObject,
    requireApiSentMessageInclusion: snapshot.kind === "api",
    sentAt: new Date(snapshot.sentAt),
  };
  const results = await Promise.allSettled([
    recordOutboundManagedMessageForSender(projection),
    ...(snapshot.kind === "api"
      ? [recordOrganizationApiMailMessage(projection)]
      : []),
    recordOrganizationMailUsage({
      ...estimateOutboundOrganizationMailUsage({
        attachmentSizeBytes: snapshot.attachments.reduce(
          (sum, attachment) => sum + attachment.size,
          0
        ),
        bcc: snapshot.bcc,
        cc: snapshot.cc,
        html: snapshot.bodyHtml,
        subject: snapshot.subject,
        text: snapshot.bodyText,
        to: snapshot.to,
      }),
      billingAccount:
        storedAccount === undefined || storedAccount === null
          ? storedAccount
          : {
              ...storedAccount,
              currentPeriodEnd: new Date(storedAccount.currentPeriodEnd),
              currentPeriodStart: new Date(storedAccount.currentPeriodStart),
            },
      occurredAt: operation.createdAt,
      organizationId: operation.organizationId,
      providerMessageId: response.messageId,
    }),
  ]);
  const failed = results.find((result) => result.status === "rejected");
  if (failed) {
    throw failed.reason;
  }
  const finalize = async (tx: DatabaseTransaction) => {
    if (
      snapshot.mailboxId !== undefined &&
      snapshot.draftId !== undefined &&
      snapshot.draftUpdatedAt !== undefined
    ) {
      const removed = await tx
        .delete(managedMailMessage)
        .where(
          and(
            eq(managedMailMessage.id, snapshot.draftId),
            eq(managedMailMessage.mailboxId, snapshot.mailboxId),
            eq(managedMailMessage.mailboxState, "draft"),
            eq(managedMailMessage.updatedAt, new Date(snapshot.draftUpdatedAt))
          )
        )
        .returning({ id: managedMailMessage.id });
      if (removed.length > 0) {
        await tx
          .update(mailbox)
          .set({
            contentRevision: sql`${mailbox.contentRevision} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(mailbox.id, snapshot.mailboxId));
      }
    }
    await tx
      .update(organizationMailSendIdempotency)
      .set({ status: "completed", updatedAt: new Date() })
      .where(
        and(
          eq(organizationMailSendIdempotency.id, operation.id),
          eq(organizationMailSendIdempotency.status, "accepted")
        )
      );
  };
  if (snapshot.mailboxId === undefined) {
    await db.transaction(finalize);
  } else {
    await withManagedSyncTransaction(
      snapshot.mailboxId,
      { messageIds: snapshot.draftId === undefined ? [] : [snapshot.draftId] },
      finalize
    );
  }
};

export const sendPreparedMail = async (input: {
  id: string;
  idempotencyKey: string;
  messageHeaderId: string;
  organizationId: string;
  raw: string;
  requestHash: string;
  snapshot: MailSendSnapshot;
}): Promise<SendMessageResult & { id: string; threadId: string }> => {
  let [operation] = await db
    .select()
    .from(organizationMailSendIdempotency)
    .where(
      and(
        eq(
          organizationMailSendIdempotency.organizationId,
          input.organizationId
        ),
        eq(organizationMailSendIdempotency.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);
  if (operation !== undefined && operation.requestHash !== input.requestHash) {
    throw new ORPCError("CONFLICT", {
      message: "Idempotency key was already used with a different message.",
    });
  }
  const isReplay = operation !== undefined;
  if (
    operation === undefined ||
    operation.status === "rejected" ||
    operation.status === "prepared"
  ) {
    await assertOrganizationOwnsVerifiedSenderDomain({
      organizationId: input.organizationId,
      sender: input.snapshot.sender,
    });
    assertLocalMailSend();
    await assertOrganizationMailRecipientsNotSuppressed({
      organizationId: input.organizationId,
      recipients: [
        ...input.snapshot.to,
        ...input.snapshot.cc,
        ...input.snapshot.bcc,
      ],
    });
    const rawObject =
      operation !== undefined &&
      operation.rawObjectBucket !== null &&
      operation.rawObjectKey !== null &&
      operation.rawObjectProvider !== null
        ? {
            bucket: operation.rawObjectBucket,
            key: operation.rawObjectKey,
            provider: operation.rawObjectProvider,
          }
        : await storeRawMailObject(new TextEncoder().encode(input.raw));
    operation = await reserveOrganizationMailSend({ ...input, rawObject });
  }
  if (operation.requestHash !== input.requestHash) {
    throw new ORPCError("CONFLICT", {
      message: "Idempotency key was already used with a different message.",
    });
  }
  if (operation.status === "prepared") {
    const region = serverEnv.AWS_REGION ?? serverEnv.AWS_DEFAULT_REGION;
    if (region === undefined || region === "") {
      throw new Error("Mail sending is not configured.");
    }
    sesClient ??= new SESv2Client({ maxAttempts: 1, region });
    const raw = await readRawMailObject({
      ...operation,
      s3Bucket: null,
      s3Key: null,
    });
    const [claimed] = await db
      .update(organizationMailSendIdempotency)
      .set({
        attemptedAt: new Date(),
        status: "submitting",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationMailSendIdempotency.id, operation.id),
          eq(organizationMailSendIdempotency.status, "prepared")
        )
      )
      .returning();
    if (claimed === undefined || claimed.snapshot === null) {
      throw new ORPCError("CONFLICT", { message: UNCERTAIN_DELIVERY_MESSAGE });
    }
    const { snapshot } = claimed;
    let messageId: string | undefined;
    try {
      const response = await sesClient.send(
        new SendEmailCommand({
          ConfigurationSetName: serverEnv.SES_CONFIGURATION_SET_NAME,
          Content: { Raw: { Data: raw } },
          Destination: {
            BccAddresses: snapshot.bcc,
            CcAddresses: snapshot.cc,
            ToAddresses: snapshot.to,
          },
          EmailTags: [
            ...snapshot.tags
              .filter((tag) => tag.name !== "quieter_send_id")
              .map((tag) => ({ Name: tag.name, Value: tag.value })),
            { Name: "quieter_send_id", Value: claimed.id },
          ],
          FromEmailAddress: extractMailAddress(snapshot.sender),
          ReplyToAddresses: snapshot.replyTo,
        }),
        { abortSignal: AbortSignal.timeout(60_000) }
      );
      messageId = response.MessageId;
    } catch (error) {
      const status =
        error instanceof SESv2ServiceException
          ? error.$metadata.httpStatusCode
          : undefined;
      const rejected =
        status !== undefined && status >= 400 && status < 500 && status !== 408;
      await db
        .update(organizationMailSendIdempotency)
        .set({
          failureMessage: rejected
            ? "The message could not be sent. Try again."
            : UNCERTAIN_DELIVERY_MESSAGE,
          status: rejected ? "rejected" : "unknown",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(organizationMailSendIdempotency.id, claimed.id),
            eq(organizationMailSendIdempotency.status, "submitting")
          )
        );
      reportError(error, { operation: "mail:send" });
      throw new ORPCError(rejected ? "BAD_GATEWAY" : "CONFLICT", {
        message: rejected
          ? "The message could not be sent. Try again."
          : UNCERTAIN_DELIVERY_MESSAGE,
      });
    }
    if (messageId === undefined || messageId === "") {
      await db
        .update(organizationMailSendIdempotency)
        .set({ status: "unknown", updatedAt: new Date() })
        .where(
          and(
            eq(organizationMailSendIdempotency.id, claimed.id),
            eq(organizationMailSendIdempotency.status, "submitting")
          )
        );
      throw new ORPCError("CONFLICT", { message: UNCERTAIN_DELIVERY_MESSAGE });
    }
    const [accepted] = await db
      .update(organizationMailSendIdempotency)
      .set({
        response: { messageId, sent: true },
        status: "accepted",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(organizationMailSendIdempotency.id, claimed.id),
          inArray(organizationMailSendIdempotency.status, [
            "submitting",
            "unknown",
            "accepted",
          ])
        )
      )
      .returning()
      .catch((error: unknown) => {
        reportError(error, { operation: "mail:persist-acceptance" });
        throw new ORPCError("CONFLICT", {
          message: UNCERTAIN_DELIVERY_MESSAGE,
        });
      });
    const [current] =
      accepted === undefined
        ? await db
            .select()
            .from(organizationMailSendIdempotency)
            .where(eq(organizationMailSendIdempotency.id, claimed.id))
            .limit(1)
        : [accepted];
    if (current === undefined) {
      throw new ORPCError("CONFLICT", { message: UNCERTAIN_DELIVERY_MESSAGE });
    }
    operation = current;
  }
  if (
    (operation.status !== "accepted" && operation.status !== "completed") ||
    operation.response === null
  ) {
    throw new ORPCError("CONFLICT", { message: UNCERTAIN_DELIVERY_MESSAGE });
  }
  try {
    await completeMailSend(operation);
  } catch (error) {
    reportError(error, { operation: "mail:complete-send" });
  }
  return {
    ...operation.response,
    id: operation.id,
    idempotent: isReplay,
    threadId: operation.snapshot?.threadId ?? operation.id,
  };
};

export const recoverMailSends = async () => {
  const now = new Date();
  await db
    .update(organizationMailSendIdempotency)
    .set({ status: "unknown", updatedAt: now })
    .where(
      and(
        eq(organizationMailSendIdempotency.status, "submitting"),
        lt(
          organizationMailSendIdempotency.updatedAt,
          new Date(now.getTime() - 2 * 60_000)
        )
      )
    );
  const operations = await db
    .select()
    .from(organizationMailSendIdempotency)
    .where(eq(organizationMailSendIdempotency.status, "accepted"))
    .orderBy(asc(organizationMailSendIdempotency.updatedAt))
    .limit(25);
  const results = await Promise.allSettled(
    operations.map(async (operation) => {
      await db
        .update(organizationMailSendIdempotency)
        .set({ updatedAt: now })
        .where(
          and(
            eq(organizationMailSendIdempotency.id, operation.id),
            eq(organizationMailSendIdempotency.status, "accepted")
          )
        );
      await completeMailSend(operation);
    })
  );
  for (const result of results) {
    if (result.status === "rejected") {
      reportError(result.reason, { operation: "mail:recover-send" });
    }
  }
  await db
    .delete(organizationMailSendIdempotency)
    .where(
      and(
        inArray(organizationMailSendIdempotency.status, [
          "completed",
          "rejected",
          "prepared",
        ]),
        lt(
          organizationMailSendIdempotency.updatedAt,
          new Date(now.getTime() - 7 * 24 * 60 * 60_000)
        )
      )
    );
};
