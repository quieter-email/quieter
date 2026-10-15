CREATE TABLE "dailyBriefEdition" (
	"generatedAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"items" jsonb NOT NULL,
	"localDate" text NOT NULL,
	"settingsId" text NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dailyBriefFeedback" (
	"action" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"deferUntil" timestamp,
	"id" text PRIMARY KEY,
	"itemId" text NOT NULL,
	"preference" text,
	"settingsId" text NOT NULL,
	"sourceMessageIds" jsonb NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "daily_brief_feedback_settings_item_unique" UNIQUE("settingsId","itemId"),
	CONSTRAINT "daily_brief_feedback_action_check" CHECK ("action" in ('not_important', 'dismiss', 'defer'))
);
--> statement-breakpoint
CREATE TABLE "dailyBriefSettings" (
	"createdAt" timestamp NOT NULL,
	"editionId" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"generationDay" text,
	"generationsToday" integer DEFAULT 0 NOT NULL,
	"id" text PRIMARY KEY,
	"lastAttemptAt" timestamp,
	"lastError" text,
	"leaseExpiresAt" timestamp,
	"leaseToken" text,
	"localTime" text DEFAULT '06:00' NOT NULL,
	"mailboxId" text NOT NULL,
	"nextRunAt" timestamp,
	"revision" integer DEFAULT 0 NOT NULL,
	"scheduleEnabled" boolean DEFAULT false NOT NULL,
	"timeZone" text DEFAULT 'UTC' NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"urgentPending" boolean DEFAULT false NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "daily_brief_settings_mailbox_user_unique" UNIQUE("mailboxId","userId")
);
--> statement-breakpoint
CREATE INDEX "daily_brief_edition_settings_idx" ON "dailyBriefEdition" ("settingsId");--> statement-breakpoint
CREATE INDEX "daily_brief_feedback_settings_updated_idx" ON "dailyBriefFeedback" ("settingsId","updatedAt");--> statement-breakpoint
CREATE INDEX "daily_brief_settings_due_idx" ON "dailyBriefSettings" ("enabled","scheduleEnabled","nextRunAt");--> statement-breakpoint
ALTER TABLE "dailyBriefEdition" ADD CONSTRAINT "dailyBriefEdition_settingsId_dailyBriefSettings_id_fkey" FOREIGN KEY ("settingsId") REFERENCES "dailyBriefSettings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dailyBriefFeedback" ADD CONSTRAINT "dailyBriefFeedback_settingsId_dailyBriefSettings_id_fkey" FOREIGN KEY ("settingsId") REFERENCES "dailyBriefSettings"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dailyBriefSettings" ADD CONSTRAINT "dailyBriefSettings_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dailyBriefSettings" ADD CONSTRAINT "dailyBriefSettings_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;