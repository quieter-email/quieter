CREATE TABLE "mailFeedbackInbox" (
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"claimGeneration" integer DEFAULT 0 NOT NULL,
	"claimOwner" text,
	"dueAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"lastErrorCode" text,
	"leaseUntil" timestamp with time zone,
	"payload" jsonb NOT NULL,
	"payloadDigest" text NOT NULL,
	"processedAt" timestamp with time zone,
	"providerEventId" text NOT NULL,
	"providerMessageId" text,
	"receivedAt" timestamp with time zone NOT NULL,
	"region" text NOT NULL,
	"schemaVersion" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	CONSTRAINT "mail_feedback_source_event_unique" UNIQUE("source","region","providerEventId"),
	CONSTRAINT "mail_feedback_status_check" CHECK ("status" IN ('pending', 'applied', 'quarantined') AND ("processedAt" IS NOT NULL) = ("status" = 'applied')),
	CONSTRAINT "mail_feedback_claim_check" CHECK ("claimGeneration" >= 0 AND "attemptCount" >= 0 AND ("claimOwner" IS NULL) = ("leaseUntil" IS NULL)),
	CONSTRAINT "mail_feedback_payload_check" CHECK ("schemaVersion" > 0 AND "payloadDigest" ~ '^[a-f0-9]{64}$' AND octet_length("payload"::text) <= 262144)
);
--> statement-breakpoint
CREATE TABLE "mailSendAttempt" (
	"attemptNumber" integer NOT NULL,
	"completedAt" timestamp with time zone,
	"deadline" timestamp with time zone NOT NULL,
	"dispatchGeneration" integer NOT NULL,
	"failureCode" text,
	"id" text PRIMARY KEY,
	"intentAt" timestamp with time zone NOT NULL,
	"organizationId" text NOT NULL,
	"outcome" text DEFAULT 'intent' NOT NULL,
	"owner" text NOT NULL,
	"providerMessageId" text,
	"region" text NOT NULL,
	"submissionId" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_attempt_submission_number_unique" UNIQUE("submissionId","attemptNumber"),
	CONSTRAINT "mail_attempt_outcome_check" CHECK ("outcome" IN ('intent', 'unknown', 'accepted', 'rejected')),
	CONSTRAINT "mail_attempt_generation_check" CHECK ("attemptNumber" > 0 AND "dispatchGeneration" > 0 AND "deadline" > "intentAt"),
	CONSTRAINT "mail_attempt_result_check" CHECK (("providerMessageId" IS NOT NULL) = ("outcome" = 'accepted') AND ("completedAt" IS NOT NULL) = ("outcome" IN ('accepted', 'rejected')))
);
--> statement-breakpoint
CREATE TABLE "mailSubmission" (
	"acceptedAt" timestamp with time zone NOT NULL,
	"acceptedResult" jsonb NOT NULL,
	"attachmentBytes" integer NOT NULL,
	"completedAt" timestamp with time zone,
	"dispatchGeneration" integer DEFAULT 0 NOT NULL,
	"failureCode" text,
	"id" text PRIMARY KEY,
	"idempotencyKey" text NOT NULL,
	"idempotencyRetainUntil" timestamp with time zone NOT NULL,
	"mailboxId" text,
	"messageBytes" integer NOT NULL,
	"nextActionAt" timestamp with time zone NOT NULL,
	"organizationId" text NOT NULL,
	"payload" jsonb NOT NULL,
	"payloadDigest" text NOT NULL,
	"recipientCount" integer NOT NULL,
	"requestHash" text NOT NULL,
	"schemaVersion" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_submission_organization_key_unique" UNIQUE("organizationId","idempotencyKey"),
	CONSTRAINT "mail_submission_id_organization_unique" UNIQUE("id","organizationId"),
	CONSTRAINT "mail_submission_status_check" CHECK ("status" IN ('queued', 'dispatching', 'pending_confirmation', 'accepted', 'failed', 'canceled')),
	CONSTRAINT "mail_submission_counts_check" CHECK ("recipientCount" BETWEEN 1 AND 50 AND "messageBytes" >= 0 AND "attachmentBytes" >= 0 AND "dispatchGeneration" >= 0),
	CONSTRAINT "mail_submission_hash_check" CHECK ("requestHash" ~ '^[a-f0-9]{64}$' AND "payloadDigest" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "mail_submission_retention_check" CHECK ("idempotencyRetainUntil" >= "acceptedAt" + interval '7 days'),
	CONSTRAINT "mail_submission_result_check" CHECK ("acceptedResult"->>'messageId' IS NOT DISTINCT FROM "id" AND "acceptedResult"->>'status' IS NOT DISTINCT FROM 'queued'),
	CONSTRAINT "mail_submission_completion_check" CHECK (("completedAt" IS NOT NULL) = ("status" IN ('accepted', 'failed', 'canceled')))
);
--> statement-breakpoint
CREATE TABLE "mailSubmissionOutbox" (
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"claimGeneration" integer DEFAULT 0 NOT NULL,
	"claimOwner" text,
	"createdAt" timestamp with time zone NOT NULL,
	"dueAt" timestamp with time zone NOT NULL,
	"eventType" text NOT NULL,
	"id" text PRIMARY KEY,
	"lastErrorCode" text,
	"leaseUntil" timestamp with time zone,
	"organizationId" text NOT NULL,
	"publicationReceipt" text,
	"publishedAt" timestamp with time zone,
	"schemaVersion" integer DEFAULT 1 NOT NULL,
	"submissionId" text NOT NULL,
	CONSTRAINT "mail_outbox_submission_event_unique" UNIQUE("submissionId","eventType","schemaVersion"),
	CONSTRAINT "mail_outbox_event_check" CHECK ("eventType" IN ('submission.dispatch', 'submission.accepted') AND "schemaVersion" > 0),
	CONSTRAINT "mail_outbox_claim_check" CHECK ("claimGeneration" >= 0 AND "attemptCount" >= 0 AND ("claimOwner" IS NULL) = ("leaseUntil" IS NULL)),
	CONSTRAINT "mail_outbox_publication_check" CHECK (("publishedAt" IS NULL) = ("publicationReceipt" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "mailUsageReservation" (
	"attachmentBytes" integer NOT NULL,
	"billableCostMicroCents" bigint NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"includedCostMicroCents" bigint NOT NULL,
	"organizationId" text NOT NULL,
	"periodEnd" timestamp with time zone NOT NULL,
	"periodStart" timestamp with time zone NOT NULL,
	"recipientCount" integer NOT NULL,
	"sesCostMicroCents" bigint NOT NULL,
	"settledAt" timestamp with time zone,
	"status" text DEFAULT 'reserved' NOT NULL,
	"submissionId" text PRIMARY KEY,
	CONSTRAINT "mail_reservation_status_check" CHECK ("status" IN ('reserved', 'finalized', 'released') AND ("settledAt" IS NOT NULL) = ("status" <> 'reserved')),
	CONSTRAINT "mail_reservation_amounts_check" CHECK ("attachmentBytes" >= 0 AND "billableCostMicroCents" >= 0 AND "includedCostMicroCents" >= 0 AND "sesCostMicroCents" >= 0 AND "recipientCount" BETWEEN 1 AND 50 AND "periodEnd" > "periodStart")
);
--> statement-breakpoint
CREATE INDEX "mail_feedback_due_idx" ON "mailFeedbackInbox" ("dueAt","id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "mail_feedback_message_idx" ON "mailFeedbackInbox" ("region","providerMessageId");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_attempt_unresolved_unique" ON "mailSendAttempt" ("submissionId") WHERE "outcome" IN ('intent', 'unknown');--> statement-breakpoint
CREATE UNIQUE INDEX "mail_attempt_provider_message_unique" ON "mailSendAttempt" ("region","providerMessageId") WHERE "providerMessageId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "mail_attempt_reconciliation_idx" ON "mailSendAttempt" ("deadline","id") WHERE "outcome" IN ('intent', 'unknown');--> statement-breakpoint
CREATE INDEX "mail_submission_recovery_idx" ON "mailSubmission" ("nextActionAt","id") WHERE "status" IN ('queued', 'dispatching', 'pending_confirmation');--> statement-breakpoint
CREATE INDEX "mail_submission_organization_accepted_idx" ON "mailSubmission" ("organizationId","acceptedAt");--> statement-breakpoint
CREATE INDEX "mail_submission_mailbox_idx" ON "mailSubmission" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mail_outbox_due_idx" ON "mailSubmissionOutbox" ("dueAt","id") WHERE "publishedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "mail_reservation_pending_budget_idx" ON "mailUsageReservation" ("organizationId","periodStart","periodEnd") WHERE "status" = 'reserved';--> statement-breakpoint
ALTER TABLE "mailSendAttempt" ADD CONSTRAINT "mail_attempt_submission_owner_fk" FOREIGN KEY ("submissionId","organizationId") REFERENCES "mailSubmission"("id","organizationId") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailSubmission" ADD CONSTRAINT "mailSubmission_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailSubmission" ADD CONSTRAINT "mailSubmission_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailSubmissionOutbox" ADD CONSTRAINT "mail_outbox_submission_owner_fk" FOREIGN KEY ("submissionId","organizationId") REFERENCES "mailSubmission"("id","organizationId") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailUsageReservation" ADD CONSTRAINT "mail_reservation_submission_owner_fk" FOREIGN KEY ("submissionId","organizationId") REFERENCES "mailSubmission"("id","organizationId") ON DELETE RESTRICT;