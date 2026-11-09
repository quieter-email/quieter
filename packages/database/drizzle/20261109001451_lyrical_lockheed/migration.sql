CREATE TABLE "mailReminder" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"userId" text NOT NULL,
	"requestId" text NOT NULL,
	"title" text NOT NULL,
	"target" jsonb NOT NULL,
	"threadId" text,
	"dueAt" timestamp with time zone NOT NULL,
	"timeZone" text NOT NULL,
	"status" text NOT NULL,
	"version" integer NOT NULL,
	"scheduleVersion" integer NOT NULL,
	"firedAt" timestamp with time zone,
	"resolution" text,
	"evaluationStatus" text NOT NULL,
	"evaluationSummary" text,
	"createdAt" timestamp with time zone NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_reminder_request_unique" UNIQUE("mailboxId","userId","requestId"),
	CONSTRAINT "mail_reminder_status_check" CHECK ("status" in ('active', 'completed', 'cancelled', 'suspended')),
	CONSTRAINT "mail_reminder_target_check" CHECK (("target"->>'kind' = 'standalone' and "threadId" is null) or ("target"->>'kind' = 'thread' and "threadId" = "target"->>'threadId' and "target"->>'anchorMessageId' is not null))
);
--> statement-breakpoint
CREATE TABLE "mailReminderJob" (
	"usage" jsonb,
	"usageModel" text,
	"usageReportedAt" timestamp with time zone,
	"id" text PRIMARY KEY,
	"reminderId" text NOT NULL,
	"kind" text NOT NULL,
	"operationKey" text NOT NULL UNIQUE,
	"reminderVersion" integer NOT NULL,
	"scheduleVersion" integer NOT NULL,
	"eventId" text NOT NULL,
	"availableAt" timestamp with time zone NOT NULL,
	"leaseToken" text,
	"leaseUntil" timestamp with time zone,
	"attempts" integer NOT NULL,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmailComposeOperation" ADD COLUMN "followUpReminder" jsonb;--> statement-breakpoint
CREATE INDEX "mail_reminder_owner_due_idx" ON "mailReminder" ("userId","mailboxId","status","dueAt","id");--> statement-breakpoint
CREATE INDEX "mail_reminder_thread_idx" ON "mailReminder" ("mailboxId","threadId","status");--> statement-breakpoint
CREATE INDEX "mail_reminder_job_ready_idx" ON "mailReminderJob" ("kind","completedAt","availableAt","leaseUntil");--> statement-breakpoint
ALTER TABLE "mailReminder" ADD CONSTRAINT "mailReminder_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailReminder" ADD CONSTRAINT "mailReminder_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailReminderJob" ADD CONSTRAINT "mailReminderJob_reminderId_mailReminder_id_fkey" FOREIGN KEY ("reminderId") REFERENCES "mailReminder"("id") ON DELETE CASCADE;