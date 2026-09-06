import { createHash } from "node:crypto";

import { ORPCError } from "@orpc/server";
import {
  getOrganizationBillingEntitlement,
  getOrganizationSubscriptionRecord,
} from "@quieter/billing/entitlements";
import type { DatabaseClient } from "@quieter/database/client";
import {
  beginMailSendAttempt,
  recordMailSendOutcome,
  finishQueuedMailSubmission,
} from "@quieter/database/mail-attempts";
import { canonicalMailJson } from "@quieter/database/mail-ledger-json";
import { MailSendCapacityUnavailableError } from "@quieter/database/mail-send-capacity";
import { mailSubmission } from "@quieter/database/schema";
import type {
  PreparedSubmission,
  SubmissionTransportResult,
} from "@quieter/mail/submission-transport";
import { and, eq, sql } from "drizzle-orm";

import { assertLocalMailSend } from "./local-managed-mail.ts";
import { readMailSubmissionMessage } from "./mail-submission-payload.ts";
import type { SubmissionPayloadStorage } from "./mail-submission-payload.ts";
import { assertOrganizationMailRecipientsNotSuppressed } from "./organization-mail-delivery.ts";
import {
  assertOrganizationOwnsVerifiedSenderDomain,
  OrganizationMailSendError,
} from "./organization-mail-policy.ts";

export const dispatchMailSubmission = async (
  database: DatabaseClient,
  input: {
    organizationId: string;
    submissionId: string;
    owner: string;
    region: string;
    capacityKey: string;
    storage: SubmissionPayloadStorage;
    send: (message: PreparedSubmission) => Promise<SubmissionTransportResult>;
  }
) => {
  const [record] = await database
    .select({
      eligible: sql<boolean>`${mailSubmission.sendAfter} <= now()`,
      submission: mailSubmission,
    })
    .from(mailSubmission)
    .where(
      and(
        eq(mailSubmission.id, input.submissionId),
        eq(mailSubmission.organizationId, input.organizationId)
      )
    )
    .limit(1);
  if (record === undefined) {
    throw new Error("Dispatch has no durable submission.");
  }
  const { submission, eligible } = record;
  if (submission.status !== "queued" || !eligible) {
    return "inactive";
  }
  if (
    submission.schemaVersion !== 1 ||
    createHash("sha256")
      .update(canonicalMailJson(submission.payload))
      .digest("hex") !== submission.payloadDigest
  ) {
    throw new Error("Stored submission failed integrity verification.");
  }
  const built = await readMailSubmissionMessage({
    payload: submission.payload,
    storage: input.storage,
  });
  if (
    built.attachmentSizeBytes !== submission.attachmentBytes ||
    new Set([...built.to, ...built.cc, ...built.bcc]).size !==
      submission.recipientCount
  ) {
    throw new Error("Stored submission counts do not match its message.");
  }
  assertLocalMailSend();
  await getOrganizationSubscriptionRecord(input.organizationId);
  let attempt: Awaited<ReturnType<typeof beginMailSendAttempt>>;
  try {
    attempt = await beginMailSendAttempt(database, {
      async assertPolicy(transaction, current) {
        if (current.payloadDigest !== submission.payloadDigest) {
          throw new Error("Submission changed after content verification.");
        }
        const entitlement = await getOrganizationBillingEntitlement({
          database: transaction,
          feature: "organizationMail",
          organizationId: current.organizationId,
        });
        if (!entitlement.hasAccess) {
          throw new OrganizationMailSendError(
            "Team mail requires Managed billing.",
            403
          );
        }
        await assertOrganizationOwnsVerifiedSenderDomain({
          database: transaction,
          organizationId: current.organizationId,
          sender: current.payload.from,
        });
        await assertOrganizationMailRecipientsNotSuppressed({
          database: transaction,
          organizationId: current.organizationId,
          recipients: [...built.to, ...built.cc, ...built.bcc],
        });
      },
      capacityKey: input.capacityKey,
      organizationId: input.organizationId,
      owner: input.owner,
      region: input.region,
      submissionId: input.submissionId,
    });
  } catch (error) {
    if (error instanceof MailSendCapacityUnavailableError) {
      const deferred = await finishQueuedMailSubmission(database, submission, {
        code: error.code,
        retryAt: error.retryAt,
      });
      return deferred ? "queued" : "inactive";
    }
    if (
      (error instanceof OrganizationMailSendError &&
        [400, 403, 422].includes(error.status)) ||
      (error instanceof ORPCError && [400, 403, 422].includes(error.status))
    ) {
      const failed = await finishQueuedMailSubmission(database, submission, {
        code: "send_policy_rejected",
      });
      return failed ? "failed" : "inactive";
    }
    throw error;
  }
  if (attempt === null) {
    return "inactive";
  }
  let outcome: SubmissionTransportResult;
  try {
    outcome = await input.send({
      attemptId: attempt.id,
      bcc: built.bcc,
      cc: built.cc,
      deadline: attempt.deadline,
      from: built.fromAddress,
      raw: built.raw,
      replyTo: built.replyTo,
      submissionId: submission.id,
      tags: submission.payload.tags,
      to: built.to,
    });
  } catch {
    outcome = { code: "provider_outcome_unknown", outcome: "unknown" };
  }
  const retryAt =
    outcome.outcome === "rejected" &&
    outcome.retryable &&
    attempt.attemptNumber < 5
      ? new Date(
          Date.now() +
            Math.ceil(
              Math.min(60_000, 5000 * 2 ** (attempt.attemptNumber - 1)) *
                (0.5 + Math.random() / 2)
            )
        )
      : undefined;
  await recordMailSendOutcome(
    database,
    attempt,
    outcome.outcome === "rejected"
      ? { code: outcome.code, outcome: "rejected", retryAt }
      : outcome
  );
  if (outcome.outcome === "accepted") {
    return "accepted";
  }
  if (outcome.outcome === "unknown") {
    return "pending_confirmation";
  }
  return retryAt === undefined ? "failed" : "queued";
};
