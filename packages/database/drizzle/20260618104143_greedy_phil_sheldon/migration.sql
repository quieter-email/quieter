CREATE TABLE "managedMailAttachment" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"fileName" text NOT NULL,
	"normalizedFileName" text NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"inline" boolean DEFAULT false NOT NULL,
	"contentId" text,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "managedMailLabel" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"color" text DEFAULT 'gray' NOT NULL,
	"description" text,
	"visible" boolean DEFAULT true NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"createdByUserId" text,
	"updatedByUserId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_label_mailbox_normalized_name_unique" UNIQUE("mailboxId","normalizedName")
);
--> statement-breakpoint
CREATE TABLE "managedMailMessageLabel" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"labelId" text NOT NULL,
	"source" text NOT NULL,
	"ruleId" text,
	"assignedByUserId" text,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_message_label_message_label_unique" UNIQUE("messageId","labelId"),
	CONSTRAINT "managed_mail_message_label_source_check" CHECK ("source" in ('manual', 'rule', 'inherited', 'backfill'))
);
--> statement-breakpoint
CREATE TABLE "managedMailRule" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"matchMode" text DEFAULT 'all' NOT NULL,
	"search" jsonb NOT NULL,
	"labelIds" jsonb NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"createdByUserId" text,
	"updatedByUserId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_rule_mailbox_normalized_name_unique" UNIQUE("mailboxId","normalizedName"),
	CONSTRAINT "managed_mail_rule_match_mode_check" CHECK ("matchMode" in ('all', 'any'))
);
--> statement-breakpoint
CREATE TABLE "managedMailRuleApplication" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"ruleId" text NOT NULL,
	"messageId" text NOT NULL,
	"matched" boolean NOT NULL,
	"error" text,
	"appliedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_rule_application_rule_message_unique" UNIQUE("ruleId","messageId")
);
--> statement-breakpoint
CREATE TABLE "managedMailRuleBackfill" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"ruleId" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"cursor" text,
	"processedCount" integer DEFAULT 0 NOT NULL,
	"matchedCount" integer DEFAULT 0 NOT NULL,
	"updatedCount" integer DEFAULT 0 NOT NULL,
	"errorCount" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"cancelledAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_rule_backfill_status_check" CHECK ("status" in ('pending', 'running', 'completed', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "managedMailSavedView" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"ownerUserId" text,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"search" jsonb NOT NULL,
	"sort" text DEFAULT 'newest' NOT NULL,
	"color" text,
	"icon" text,
	"position" integer DEFAULT 0 NOT NULL,
	"disabledReason" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_saved_view_mailbox_owner_name_unique" UNIQUE("mailboxId","ownerUserId","normalizedName"),
	CONSTRAINT "managed_mail_saved_view_sort_check" CHECK ("sort" in ('newest', 'oldest', 'relevance'))
);
--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "fromNormalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "toNormalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "ccNormalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "bccNormalized" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "searchText" text DEFAULT '' NOT NULL;--> statement-breakpoint
UPDATE "managedMailMessage"
SET
	"fromNormalized" = lower(coalesce("from", '')),
	"toNormalized" = lower(coalesce("to", '')),
	"ccNormalized" = lower(coalesce("cc", '')),
	"bccNormalized" = lower(coalesce("bcc", '')),
	"searchText" = concat_ws(' ', "subject", "snippet", "bodyText");--> statement-breakpoint
CREATE INDEX "managed_mail_message_search_text_idx"
ON "managedMailMessage"
USING gin (to_tsvector('simple', "searchText"));--> statement-breakpoint
CREATE INDEX "managed_mail_attachment_mailbox_name_idx" ON "managedMailAttachment" ("mailboxId","normalizedFileName");--> statement-breakpoint
CREATE INDEX "managed_mail_attachment_message_idx" ON "managedMailAttachment" ("messageId");--> statement-breakpoint
CREATE INDEX "managed_mail_label_mailbox_position_idx" ON "managedMailLabel" ("mailboxId","position");--> statement-breakpoint
CREATE INDEX "managed_mail_message_mailbox_from_normalized_idx" ON "managedMailMessage" ("mailboxId","fromNormalized");--> statement-breakpoint
CREATE INDEX "managed_mail_message_mailbox_sent_at_id_idx" ON "managedMailMessage" ("mailboxId","sentAt","id");--> statement-breakpoint
CREATE INDEX "managed_mail_message_label_mailbox_label_idx" ON "managedMailMessageLabel" ("mailboxId","labelId");--> statement-breakpoint
CREATE INDEX "managed_mail_message_label_message_idx" ON "managedMailMessageLabel" ("messageId");--> statement-breakpoint
CREATE INDEX "managed_mail_rule_mailbox_enabled_priority_idx" ON "managedMailRule" ("mailboxId","enabled","priority");--> statement-breakpoint
CREATE INDEX "managed_mail_rule_application_mailbox_created_idx" ON "managedMailRuleApplication" ("mailboxId","createdAt");--> statement-breakpoint
CREATE INDEX "managed_mail_rule_backfill_rule_status_idx" ON "managedMailRuleBackfill" ("ruleId","status");--> statement-breakpoint
CREATE INDEX "managed_mail_saved_view_mailbox_owner_position_idx" ON "managedMailSavedView" ("mailboxId","ownerUserId","position");--> statement-breakpoint
ALTER TABLE "managedMailAttachment" ADD CONSTRAINT "managedMailAttachment_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailAttachment" ADD CONSTRAINT "managedMailAttachment_messageId_managedMailMessage_id_fkey" FOREIGN KEY ("messageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailLabel" ADD CONSTRAINT "managedMailLabel_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailLabel" ADD CONSTRAINT "managedMailLabel_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailLabel" ADD CONSTRAINT "managedMailLabel_updatedByUserId_user_id_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" ADD CONSTRAINT "managedMailMessageLabel_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" ADD CONSTRAINT "managedMailMessageLabel_messageId_managedMailMessage_id_fkey" FOREIGN KEY ("messageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" ADD CONSTRAINT "managedMailMessageLabel_labelId_managedMailLabel_id_fkey" FOREIGN KEY ("labelId") REFERENCES "managedMailLabel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" ADD CONSTRAINT "managedMailMessageLabel_ruleId_managedMailRule_id_fkey" FOREIGN KEY ("ruleId") REFERENCES "managedMailRule"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessageLabel" ADD CONSTRAINT "managedMailMessageLabel_assignedByUserId_user_id_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD CONSTRAINT "managedMailRule_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD CONSTRAINT "managedMailRule_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD CONSTRAINT "managedMailRule_updatedByUserId_user_id_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedMailRuleApplication" ADD CONSTRAINT "managedMailRuleApplication_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleApplication" ADD CONSTRAINT "managedMailRuleApplication_ruleId_managedMailRule_id_fkey" FOREIGN KEY ("ruleId") REFERENCES "managedMailRule"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleApplication" ADD CONSTRAINT "managedMailRuleApplication_messageId_managedMailMessage_id_fkey" FOREIGN KEY ("messageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD CONSTRAINT "managedMailRuleBackfill_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD CONSTRAINT "managedMailRuleBackfill_ruleId_managedMailRule_id_fkey" FOREIGN KEY ("ruleId") REFERENCES "managedMailRule"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailSavedView" ADD CONSTRAINT "managedMailSavedView_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailSavedView" ADD CONSTRAINT "managedMailSavedView_ownerUserId_user_id_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE;
