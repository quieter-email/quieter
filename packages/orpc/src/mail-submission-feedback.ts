import { createHash } from "node:crypto";

import type { DatabaseClient } from "@quieter/database/client";
import { recordMailSendOutcome } from "@quieter/database/mail-attempts";
import {
  claimMailFeedback,
  deferMailFeedback,
} from "@quieter/database/mail-feedback-inbox";
import type { MailFeedbackClaim } from "@quieter/database/mail-feedback-inbox";
import { canonicalMailJson } from "@quieter/database/mail-ledger-json";
import {
  mailFeedbackInbox,
  mailSendAttempt,
  mailSubmission,
} from "@quieter/database/schema";
import {
  getSendEnvelopeAddress,
  getSendEnvelopeAddressList,
} from "@quieter/mail/send";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  recordOrganizationMailFeedback,
  resolveOrganizationId,
} from "./organization-mail-delivery.ts";
import { parseSesFeedbackNotification } from "./ses-feedback.ts";

const envelopeSchema = z.object({
  Message: z.string(),
  MessageId: z.string(),
  TopicArn: z.string(),
  Type: z.literal("Notification"),
});
const mailSchema = z.object({
  mail: z.object({
    destination: z.array(z.string()).min(1).max(50),
    messageId: z.string().regex(/^[\w-]{1,256}$/u),
    source: z.string(),
    tags: z.record(z.string(), z.array(z.string())).optional(),
    timestamp: z.iso.datetime({ offset: true }),
  }),
});
const correlationSchema = z.object({
  attemptId: z.uuid(),
  submissionId: z.uuid(),
});

export const applyMailSubmissionFeedback = async (
  database: DatabaseClient,
  input: {
    inboxId: string;
    expectedSource: string;
    region: string;
    claim?: MailFeedbackClaim;
  }
) =>
  await database.transaction(async (transaction) => {
    const [inbox] = await transaction
      .select()
      .from(mailFeedbackInbox)
      .where(eq(mailFeedbackInbox.id, input.inboxId))
      .for("update", { skipLocked: true });
    if (inbox === undefined) {
      return "busy";
    }
    if (inbox.status !== "pending") {
      return inbox.status;
    }
    if (
      input.claim !== undefined &&
      (input.claim.id !== inbox.id ||
        input.claim.claimOwner !== inbox.claimOwner ||
        input.claim.claimGeneration !== inbox.claimGeneration)
    ) {
      return "superseded";
    }
    const quarantine = async (code: string) => {
      await transaction
        .update(mailFeedbackInbox)
        .set({
          claimGeneration: sql`${mailFeedbackInbox.claimGeneration} + 1`,
          claimOwner: null,
          lastErrorCode: code,
          leaseUntil: null,
          status: "quarantined",
        })
        .where(eq(mailFeedbackInbox.id, inbox.id));
      return "quarantined" as const;
    };
    if (
      inbox.source !== input.expectedSource ||
      inbox.region !== input.region
    ) {
      return await quarantine("feedback_source_mismatch");
    }
    if (
      inbox.schemaVersion !== 1 ||
      createHash("sha256")
        .update(canonicalMailJson(inbox.payload))
        .digest("hex") !== inbox.payloadDigest
    ) {
      return await quarantine("feedback_schema_or_digest_invalid");
    }
    const envelope = envelopeSchema.safeParse(inbox.payload);
    if (
      !envelope.success ||
      envelope.data.MessageId !== inbox.providerEventId ||
      envelope.data.TopicArn !== input.expectedSource
    ) {
      return await quarantine("feedback_envelope_invalid");
    }
    let notification: unknown;
    try {
      notification = JSON.parse(envelope.data.Message);
    } catch {
      return await quarantine("feedback_json_invalid");
    }
    const parsed = mailSchema.safeParse(notification);
    if (
      !parsed.success ||
      (inbox.providerMessageId !== null &&
        inbox.providerMessageId !== parsed.data.mail.messageId)
    ) {
      return await quarantine("feedback_mail_invalid");
    }
    let feedback;
    try {
      feedback = parseSesFeedbackNotification(
        envelope.data,
        input.expectedSource
      );
    } catch {
      return await quarantine("feedback_details_invalid");
    }
    if (feedback === null) {
      return await quarantine("feedback_event_unsupported");
    }
    const { mail } = parsed.data;
    const attemptTags = mail.tags?.quieter_attempt;
    const submissionTags = mail.tags?.quieter_submission;
    let organizationId: string | null;
    if (attemptTags === undefined && submissionTags === undefined) {
      organizationId = await resolveOrganizationId(
        feedback.providerMessageId,
        transaction
      );
      if (organizationId === null) {
        await transaction
          .update(mailFeedbackInbox)
          .set({
            claimGeneration: sql`${mailFeedbackInbox.claimGeneration} + 1`,
            claimOwner: null,
            dueAt: sql`now() + interval '5 minutes'`,
            lastErrorCode: "feedback_mapping_pending",
            leaseUntil: null,
          })
          .where(eq(mailFeedbackInbox.id, inbox.id));
        return "pending";
      }
    } else {
      const correlation = correlationSchema.safeParse({
        attemptId: attemptTags?.[0],
        submissionId: submissionTags?.[0],
      });
      if (
        !correlation.success ||
        attemptTags?.length !== 1 ||
        submissionTags?.length !== 1
      ) {
        return await quarantine("feedback_correlation_invalid");
      }
      const [submission] = await transaction
        .select()
        .from(mailSubmission)
        .where(eq(mailSubmission.id, correlation.data.submissionId))
        .for("update");
      const [attempt] = await transaction
        .select()
        .from(mailSendAttempt)
        .where(
          and(
            eq(mailSendAttempt.id, correlation.data.attemptId),
            eq(mailSendAttempt.submissionId, correlation.data.submissionId),
            eq(mailSendAttempt.region, input.region)
          )
        )
        .limit(1);
      if (
        submission === undefined ||
        attempt === undefined ||
        attempt.organizationId !== submission.organizationId
      ) {
        return await quarantine("feedback_attempt_missing");
      }
      const source =
        /^arn:aws:sns:(?<region>[^:]+):(?<account>\d{12}):[^:]+$/u.exec(
          input.expectedSource
        );
      const destinations = getSendEnvelopeAddressList(
        mail.destination
      ).toSorted();
      const expectedRecipients = getSendEnvelopeAddressList([
        ...submission.payload.to,
        ...submission.payload.cc,
        ...submission.payload.bcc,
      ]).toSorted();
      if (
        attempt.capacityKey !== `${source?.groups?.account}:${input.region}` ||
        source?.groups?.region !== input.region ||
        getSendEnvelopeAddress(mail.source) !==
          getSendEnvelopeAddress(submission.payload.from) ||
        canonicalMailJson(destinations) !==
          canonicalMailJson(expectedRecipients) ||
        feedback.recipients.some(
          (recipient) =>
            !expectedRecipients.includes(
              getSendEnvelopeAddress(recipient.emailAddress)
            )
        ) ||
        new Date(mail.timestamp).getTime() <
          attempt.intentAt.getTime() - 60_000 ||
        attempt.outcome === "rejected" ||
        (attempt.providerMessageId !== null &&
          attempt.providerMessageId !== feedback.providerMessageId)
      ) {
        return await quarantine("feedback_attempt_conflict");
      }
      await recordMailSendOutcome(transaction, attempt, {
        outcome: "accepted",
        providerMessageId: feedback.providerMessageId,
      });
      ({ organizationId } = submission);
    }
    await recordOrganizationMailFeedback(feedback, {
      organizationId,
      transaction,
    });
    await transaction
      .update(mailFeedbackInbox)
      .set({
        claimGeneration: sql`${mailFeedbackInbox.claimGeneration} + 1`,
        claimOwner: null,
        lastErrorCode: null,
        leaseUntil: null,
        processedAt: sql`now()`,
        providerMessageId: feedback.providerMessageId,
        status: "applied",
      })
      .where(eq(mailFeedbackInbox.id, inbox.id));
    return "applied";
  });

export const recoverMailSubmissionFeedback = async (
  database: DatabaseClient,
  input: {
    owner: string;
    expectedSource: string;
    region: string;
    limit: number;
  }
) => {
  const claims = await claimMailFeedback(database, {
    limit: input.limit,
    owner: input.owner,
    region: input.region,
    source: input.expectedSource,
  });
  const results = await Promise.all(
    claims.map(async (claim) => {
      try {
        return await applyMailSubmissionFeedback(database, {
          claim,
          expectedSource: input.expectedSource,
          inboxId: claim.id,
          region: input.region,
        });
      } catch {
        await deferMailFeedback(database, claim);
        return "deferred";
      }
    })
  );
  return {
    applied: results.filter((result) => result === "applied").length,
    claimed: claims.length,
    deferred: results.filter((result) => result === "deferred").length,
    pending: results.filter((result) => result === "pending").length,
    quarantined: results.filter((result) => result === "quarantined").length,
  };
};
