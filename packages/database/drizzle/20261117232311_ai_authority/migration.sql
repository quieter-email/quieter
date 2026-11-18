-- quieter:contract
CREATE TABLE "mailboxAiAuthority" (
	"automationPaused" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"mailboxId" text PRIMARY KEY,
	"readOnly" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"updatedByUserId" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mailbox_ai_authority_version_check" CHECK ("version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "privateContextUserId" text;--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailReminderJob" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "scheduledMailSend" ADD COLUMN "cancellationOrigin" jsonb;--> statement-breakpoint
ALTER TABLE "mailboxAiAuthority" ADD CONSTRAINT "mailboxAiAuthority_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAiAuthority" ADD CONSTRAINT "mailboxAiAuthority_updatedByUserId_user_id_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD CONSTRAINT "gmail_auto_label_event_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD CONSTRAINT "mail_message_importance_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailReminderJob" ADD CONSTRAINT "mail_reminder_job_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD CONSTRAINT "mail_reminder_suggestion_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD CONSTRAINT "mailbox_verification_code_authority_version_check" CHECK ("authorityVersion" >= 0);