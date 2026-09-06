import { createHash } from "node:crypto";

import type { DatabaseClient } from "@quieter/database/client";
import { canonicalMailJson } from "@quieter/database/mail-ledger-json";
import {
  mailSendAttempt,
  mailSubmission,
  mailSubmissionOutbox,
  organizationApiMailMessage,
} from "@quieter/database/schema";
import type { MailSubmissionEvent } from "@quieter/mail/submission-events";
import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { readMailSubmissionMessage } from "./mail-submission-payload.ts";
import type { SubmissionPayloadStorage } from "./mail-submission-payload.ts";
import { recordOutboundManagedMessageForSender } from "./managed-mail/messages/outbound-record.ts";
import { recordOrganizationApiMailMessage } from "./organization-api-mail-record.ts";

export const projectMailSubmission = async (
  database: DatabaseClient,
  event: MailSubmissionEvent,
  storage: SubmissionPayloadStorage
) => {
  const [record] = await database
    .select({ submission: mailSubmission })
    .from(mailSubmissionOutbox)
    .innerJoin(
      mailSubmission,
      and(
        eq(mailSubmission.id, mailSubmissionOutbox.submissionId),
        eq(mailSubmission.organizationId, mailSubmissionOutbox.organizationId)
      )
    )
    .where(
      and(
        eq(mailSubmissionOutbox.id, event.id),
        eq(mailSubmissionOutbox.submissionId, event.submissionId),
        eq(mailSubmissionOutbox.organizationId, event.organizationId),
        eq(mailSubmissionOutbox.eventType, event.eventType),
        eq(mailSubmissionOutbox.schemaVersion, event.schemaVersion)
      )
    )
    .limit(1);
  if (record === undefined || event.eventType === "submission.dispatch") {
    throw new Error("Projection has no matching durable event.");
  }
  const { submission } = record;
  if (event.eventType === "submission.failed") {
    if (submission.status !== "failed") {
      throw new Error("Failure projection conflicts with the ledger.");
    }
    return "failed";
  }
  if (
    submission.status !== "accepted" ||
    submission.mailboxId !== null ||
    submission.schemaVersion !== 1 ||
    createHash("sha256")
      .update(canonicalMailJson(submission.payload))
      .digest("hex") !== submission.payloadDigest
  ) {
    throw new Error("Accepted projection failed ledger verification.");
  }
  const [existing] = await database
    .select({ id: organizationApiMailMessage.id })
    .from(organizationApiMailMessage)
    .innerJoin(
      mailSendAttempt,
      and(
        eq(
          mailSendAttempt.organizationId,
          organizationApiMailMessage.organizationId
        ),
        eq(
          mailSendAttempt.providerMessageId,
          organizationApiMailMessage.providerMessageId
        )
      )
    )
    .where(
      and(
        eq(mailSendAttempt.submissionId, submission.id),
        eq(mailSendAttempt.organizationId, submission.organizationId),
        eq(mailSendAttempt.outcome, "accepted")
      )
    )
    .limit(1);
  if (existing !== undefined) {
    return "duplicate";
  }
  const built = await readMailSubmissionMessage({
    payload: submission.payload,
    storage,
  });
  return await database.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(mailSubmission)
      .where(
        and(
          eq(mailSubmission.id, submission.id),
          eq(mailSubmission.organizationId, submission.organizationId)
        )
      )
      .for("update");
    if (
      current === undefined ||
      current.status !== "accepted" ||
      current.payloadDigest !== submission.payloadDigest
    ) {
      throw new Error("Submission changed during projection preparation.");
    }
    const attempts = await transaction
      .select()
      .from(mailSendAttempt)
      .where(
        and(
          eq(mailSendAttempt.submissionId, submission.id),
          eq(mailSendAttempt.organizationId, submission.organizationId),
          eq(mailSendAttempt.outcome, "accepted")
        )
      )
      .limit(2);
    if (attempts.length !== 1 || attempts[0].providerMessageId === null) {
      throw new Error("Accepted projection requires one confirmed attempt.");
    }
    const input = {
      attachments: built.attachments,
      bcc: built.bcc,
      bodyHtml: submission.payload.html ?? undefined,
      bodyText: submission.payload.text ?? undefined,
      cc: built.cc,
      headers: built.headers,
      messageHeaderId: built.messageHeaderId,
      organizationId: submission.organizationId,
      providerMessageId: attempts[0].providerMessageId,
      rawSizeBytes: built.rawSizeBytes,
      replyTo: built.replyTo,
      sender: submission.payload.from,
      senderAddress: built.fromAddress,
      sentAt: attempts[0].intentAt,
      subject: submission.payload.subject,
      to: built.to,
    };
    const projected = await recordOrganizationApiMailMessage(
      input,
      transaction
    );
    if (projected === null) {
      return "duplicate";
    }
    await recordOutboundManagedMessageForSender(
      { ...input, requireApiSentMessageInclusion: true },
      transaction
    );
    return "projected";
  });
};

export const recoverMailSubmissionProjections = async (
  database: DatabaseClient,
  storage: SubmissionPayloadStorage
) => {
  const events = await database
    .select({
      eventType: mailSubmissionOutbox.eventType,
      id: mailSubmissionOutbox.id,
      organizationId: mailSubmissionOutbox.organizationId,
      schemaVersion: mailSubmissionOutbox.schemaVersion,
      submissionId: mailSubmissionOutbox.submissionId,
    })
    .from(mailSubmissionOutbox)
    .innerJoin(
      mailSendAttempt,
      and(
        eq(mailSendAttempt.submissionId, mailSubmissionOutbox.submissionId),
        eq(mailSendAttempt.organizationId, mailSubmissionOutbox.organizationId),
        eq(mailSendAttempt.outcome, "accepted")
      )
    )
    .innerJoin(
      mailSubmission,
      and(
        eq(mailSubmission.id, mailSubmissionOutbox.submissionId),
        eq(mailSubmission.organizationId, mailSubmissionOutbox.organizationId)
      )
    )
    .leftJoin(
      organizationApiMailMessage,
      and(
        eq(
          organizationApiMailMessage.organizationId,
          mailSendAttempt.organizationId
        ),
        eq(
          organizationApiMailMessage.providerMessageId,
          mailSendAttempt.providerMessageId
        )
      )
    )
    .where(
      and(
        eq(mailSubmissionOutbox.eventType, "submission.accepted"),
        eq(mailSubmission.status, "accepted"),
        lte(mailSubmission.nextActionAt, sql`now()`),
        isNull(organizationApiMailMessage.id)
      )
    )
    .orderBy(mailSubmission.nextActionAt, mailSubmissionOutbox.id)
    .limit(5);
  let projected = 0;
  let deferred = 0;
  for (const event of events) {
    try {
      if (event.schemaVersion !== 1) {
        throw new Error("Unsupported projection contract.");
      }
      // oxlint-disable-next-line no-await-in-loop -- Process at most five retained payloads without multiplying attachment memory.
      const result = await projectMailSubmission(
        database,
        { ...event, schemaVersion: 1 },
        storage
      );
      if (result === "projected") {
        projected += 1;
      }
    } catch {
      // oxlint-disable-next-line no-await-in-loop -- Move a failed projection behind other due work before continuing the bounded recovery batch.
      await database
        .update(mailSubmission)
        .set({ nextActionAt: sql`now() + interval '1 minute'` })
        .where(
          and(
            eq(mailSubmission.id, event.submissionId),
            eq(mailSubmission.organizationId, event.organizationId),
            eq(mailSubmission.status, "accepted")
          )
        );
      deferred += 1;
    }
  }
  return { deferred, projected };
};
