CREATE TABLE "mailSyncSubmission" (
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"mailboxId" text,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"operationId" text,
	"payloadHash" text NOT NULL,
	"recoveryKey" text NOT NULL,
	"result" jsonb,
	"status" text DEFAULT 'unknown' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "mailSyncSubmission_pkey" PRIMARY KEY("mailboxId","operationId")
);
--> statement-breakpoint
CREATE INDEX "mail_sync_submission_recovery_idx" ON "mailSyncSubmission" ("mailboxId","status","nextAttemptAt");--> statement-breakpoint
ALTER TABLE "mailSyncSubmission" ADD CONSTRAINT "mailSyncSubmission_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncSubmission" ADD CONSTRAINT "mailSyncSubmission_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;