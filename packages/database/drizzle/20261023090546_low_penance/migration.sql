CREATE TABLE "gmailCaptureState" (
	"mailboxId" text PRIMARY KEY,
	"phase" text DEFAULT 'pending' NOT NULL,
	"historyId" text,
	"historyPageToken" text,
	"historyChangeOffset" integer DEFAULT 0 NOT NULL,
	"recoveryOffset" integer DEFAULT 0 NOT NULL,
	"bootstrapMessageIds" jsonb,
	"bootstrapOffset" integer DEFAULT 0 NOT NULL,
	"bootstrapCompletedAt" timestamp,
	"recoveryAfter" timestamp,
	"recoveryBefore" timestamp,
	"recoveryPageToken" text,
	"reconcileAfterMessageId" text,
	"coverageGapAt" timestamp,
	"lastCapturedAt" timestamp,
	"lastErrorAt" timestamp,
	"leaseId" text,
	"leaseExpiresAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_capture_state_phase_check" CHECK ("phase" in ('pending', 'bootstrap', 'history', 'recovery', 'reconcile')),
	CONSTRAINT "gmail_capture_state_history_check" CHECK ("historyId" is null or "historyId" ~ '^[0-9]+$')
);
--> statement-breakpoint
CREATE TABLE "gmailCapturedMessage" (
	"mailboxId" text,
	"messageId" text,
	"providerRevision" text NOT NULL,
	"snapshot" jsonb,
	"analysis" jsonb,
	"source" text NOT NULL,
	"deletedAt" timestamp,
	"capturedAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmailCapturedMessage_pkey" PRIMARY KEY("mailboxId","messageId"),
	CONSTRAINT "gmail_captured_message_revision_check" CHECK ("providerRevision" ~ '^[0-9]+$'),
	CONSTRAINT "gmail_captured_message_content_check" CHECK (("deletedAt" is null and "snapshot" is not null and "analysis" is not null) or ("deletedAt" is not null and "snapshot" is null and "analysis" is null))
);
--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "analysis" jsonb;--> statement-breakpoint
CREATE INDEX "gmail_capture_state_progress_idx" ON "gmailCaptureState" ("phase","lastCapturedAt");--> statement-breakpoint
CREATE INDEX "gmail_captured_message_mailbox_captured_idx" ON "gmailCapturedMessage" ("mailboxId","capturedAt");--> statement-breakpoint
ALTER TABLE "gmailCaptureState" ADD CONSTRAINT "gmailCaptureState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailCapturedMessage" ADD CONSTRAINT "gmailCapturedMessage_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;