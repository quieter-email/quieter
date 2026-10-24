CREATE TABLE "mailImportanceAttempt" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"userId" text NOT NULL,
	"organizationId" text NOT NULL,
	"model" text NOT NULL,
	"usage" jsonb,
	"usageReportedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailMessageImportance" (
	"mailboxId" text,
	"messageId" text,
	"threadId" text NOT NULL,
	"receivedAt" timestamp NOT NULL,
	"aiImportant" boolean,
	"manualImportant" boolean,
	"manualActorUserId" text,
	"manualUpdatedAt" timestamp,
	"contentHash" text NOT NULL,
	"classifierVersion" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp NOT NULL,
	"leaseId" text,
	"leaseExpiresAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailMessageImportance_pkey" PRIMARY KEY("mailboxId","messageId")
);
--> statement-breakpoint
CREATE INDEX "mail_importance_attempt_unreported_idx" ON "mailImportanceAttempt" ("usageReportedAt");--> statement-breakpoint
CREATE INDEX "mail_importance_due_idx" ON "mailMessageImportance" ("state","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "mail_importance_thread_idx" ON "mailMessageImportance" ("mailboxId","threadId");--> statement-breakpoint
ALTER TABLE "mailImportanceAttempt" ADD CONSTRAINT "mailImportanceAttempt_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailImportanceAttempt" ADD CONSTRAINT "mailImportanceAttempt_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailImportanceAttempt" ADD CONSTRAINT "mailImportanceAttempt_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD CONSTRAINT "mailMessageImportance_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD CONSTRAINT "mailMessageImportance_manualActorUserId_user_id_fkey" FOREIGN KEY ("manualActorUserId") REFERENCES "user"("id") ON DELETE SET NULL;