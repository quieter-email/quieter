CREATE TABLE "mailAutoLabelFeedback" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"provider" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"labelId" text NOT NULL,
	"labelName" text,
	"signal" text NOT NULL,
	"source" text,
	"createdByUserId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mail_auto_label_feedback_message_label_unique" UNIQUE("mailboxId","providerMessageId","labelId"),
	CONSTRAINT "mail_auto_label_feedback_provider_check" CHECK ("provider" in ('gmail', 'managed')),
	CONSTRAINT "mail_auto_label_feedback_signal_check" CHECK ("signal" in ('added', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "mailAutomationMemoryProfile" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"agent" text NOT NULL,
	"profile" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"lastMergedAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mail_automation_memory_profile_mailbox_agent_unique" UNIQUE("mailboxId","agent"),
	CONSTRAINT "mail_automation_memory_profile_agent_check" CHECK ("agent" in ('auto_label', 'useful_detail'))
);
--> statement-breakpoint
CREATE TABLE "mailboxAutomationSettings" (
	"mailboxId" text PRIMARY KEY,
	"autoLabelEnabled" boolean DEFAULT false NOT NULL,
	"usefulDetailsEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mail_auto_label_feedback_profile_idx" ON "mailAutoLabelFeedback" ("mailboxId","labelId","source","signal");--> statement-breakpoint
CREATE INDEX "mail_automation_memory_profile_mailbox_agent_idx" ON "mailAutomationMemoryProfile" ("mailboxId","agent");--> statement-breakpoint
ALTER TABLE "mailAutoLabelFeedback" ADD CONSTRAINT "mailAutoLabelFeedback_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailAutoLabelFeedback" ADD CONSTRAINT "mailAutoLabelFeedback_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailAutomationMemoryProfile" ADD CONSTRAINT "mailAutomationMemoryProfile_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAutomationSettings" ADD CONSTRAINT "mailboxAutomationSettings_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
INSERT INTO "mailboxAutomationSettings" (
	"mailboxId",
	"autoLabelEnabled",
	"usefulDetailsEnabled",
	"createdAt",
	"updatedAt"
)
SELECT
	legacy."mailboxId",
	coalesce(auto_label."enabled", false),
	coalesce(useful_details."enabled", false),
	coalesce(auto_label."createdAt", useful_details."createdAt", now()),
	coalesce(auto_label."updatedAt", useful_details."updatedAt", now())
FROM (
	SELECT "mailboxId" FROM "gmailAutoLabelSettings"
	UNION
	SELECT "mailboxId" FROM "gmailUsefulDetailSettings"
) legacy
LEFT JOIN "gmailAutoLabelSettings" auto_label
	ON auto_label."mailboxId" = legacy."mailboxId"
LEFT JOIN "gmailUsefulDetailSettings" useful_details
	ON useful_details."mailboxId" = legacy."mailboxId"
ON CONFLICT ("mailboxId") DO UPDATE SET
	"autoLabelEnabled" = excluded."autoLabelEnabled",
	"usefulDetailsEnabled" = excluded."usefulDetailsEnabled",
	"updatedAt" = excluded."updatedAt";--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" DROP CONSTRAINT "managed_mail_message_label_source_check", ADD CONSTRAINT "managed_mail_message_label_source_check" CHECK ("source" in ('manual', 'rule', 'inherited', 'backfill', 'ai_auto_label'));
