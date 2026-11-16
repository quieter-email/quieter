-- quieter:contract
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailReminderJob" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD COLUMN "authorityVersion" integer;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD CONSTRAINT "gmail_auto_label_event_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailMessageImportance" ADD CONSTRAINT "mail_message_importance_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailReminderJob" ADD CONSTRAINT "mail_reminder_job_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailReminderSuggestion" ADD CONSTRAINT "mail_reminder_suggestion_authority_version_check" CHECK ("authorityVersion" >= 0);--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD CONSTRAINT "mailbox_verification_code_authority_version_check" CHECK ("authorityVersion" >= 0);
