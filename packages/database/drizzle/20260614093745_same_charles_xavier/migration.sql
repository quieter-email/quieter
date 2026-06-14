CREATE TABLE "gmailAutoLabelEvent" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"gmailMessageId" text NOT NULL,
	"labelIds" jsonb,
	"model" text,
	"promptTokens" integer,
	"completionTokens" integer,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp,
	"appliedAt" timestamp,
	"usageReportedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_auto_label_event_mailbox_message_unique" UNIQUE("mailboxId","gmailMessageId")
);
--> statement-breakpoint
CREATE TABLE "gmailAutoLabelSettings" (
	"mailboxId" text PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmailWatchState" (
	"mailboxId" text PRIMARY KEY,
	"historyId" text,
	"historyPageToken" text,
	"watchExpirationAt" timestamp,
	"watchRenewedAt" timestamp,
	"lastNotificationAt" timestamp,
	"lastProcessedAt" timestamp,
	"lastReconciledAt" timestamp,
	"recoveryAfter" timestamp,
	"recoveryBefore" timestamp,
	"recoveryPageToken" text,
	"processingLeaseId" text,
	"processingLeaseExpiresAt" timestamp,
	"lastError" text,
	"lastErrorAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gmail_auto_label_event_mailbox_created_at_idx" ON "gmailAutoLabelEvent" ("mailboxId","createdAt");--> statement-breakpoint
CREATE INDEX "gmail_auto_label_event_mailbox_retry_idx" ON "gmailAutoLabelEvent" ("mailboxId","appliedAt","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "gmail_watch_state_watch_expiration_at_idx" ON "gmailWatchState" ("watchExpirationAt");--> statement-breakpoint
CREATE INDEX "gmail_watch_state_processing_lease_expires_at_idx" ON "gmailWatchState" ("processingLeaseExpiresAt");--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD CONSTRAINT "gmailAutoLabelEvent_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelSettings" ADD CONSTRAINT "gmailAutoLabelSettings_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailWatchState" ADD CONSTRAINT "gmailWatchState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;