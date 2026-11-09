CREATE TABLE "mailReminderPreference" (
	"automatic" boolean DEFAULT false NOT NULL,
	"suggestions" boolean DEFAULT true NOT NULL,
	"mailboxId" text,
	"timeZone" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"userId" text,
	CONSTRAINT "mailReminderPreference_pkey" PRIMARY KEY("userId","mailboxId")
);
--> statement-breakpoint
CREATE TABLE "mailReminderSuggestion" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"automatic" boolean NOT NULL,
	"availableAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"fingerprint" text,
	"id" text PRIMARY KEY,
	"leaseToken" text,
	"leaseUntil" timestamp with time zone,
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"result" jsonb,
	"reminderId" text,
	"status" text NOT NULL,
	"threadId" text NOT NULL,
	"timeZone" text NOT NULL,
	"usage" jsonb,
	"usageModel" text,
	"usageReportedAt" timestamp with time zone,
	"userId" text NOT NULL,
	CONSTRAINT "mail_reminder_suggestion_source_unique" UNIQUE("userId","mailboxId","messageId"),
	CONSTRAINT "mail_reminder_suggestion_status_check" CHECK ("status" in ('pending', 'none', 'suggested', 'accepted', 'dismissed'))
);
--> statement-breakpoint
ALTER TABLE "mailReminder" ADD COLUMN "source" jsonb;--> statement-breakpoint
CREATE INDEX "mail_reminder_suggestion_work_idx" ON "mailReminderSuggestion" ("status","availableAt","leaseUntil");--> statement-breakpoint
ALTER TABLE "mailReminderPreference" ADD CONSTRAINT "mailReminderPreference_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailReminderPreference" ADD CONSTRAINT "mailReminderPreference_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD CONSTRAINT "mailReminderSuggestion_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD CONSTRAINT "mailReminderSuggestion_reminderId_mailReminder_id_fkey" FOREIGN KEY ("reminderId") REFERENCES "mailReminder"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD CONSTRAINT "mailReminderSuggestion_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;