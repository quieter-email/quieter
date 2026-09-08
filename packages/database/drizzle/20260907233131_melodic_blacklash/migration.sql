CREATE TABLE "mailObjectCleanup" (
	"bucket" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"key" text NOT NULL,
	"notBefore" timestamp NOT NULL,
	"provider" text NOT NULL,
	CONSTRAINT "mail_object_cleanup_reference_unique" UNIQUE("provider","bucket","key")
);
--> statement-breakpoint
CREATE TABLE "managedMailRuleRun" (
	"actionResults" jsonb NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"definition" jsonb NOT NULL,
	"error" text,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"matched" boolean NOT NULL,
	"messageId" text NOT NULL,
	"revision" text NOT NULL,
	"ruleId" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_rule_run_revision_unique" UNIQUE("ruleId","messageId","revision")
);
--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD COLUMN "disabledReason" text;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "leaseId" text;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "leasedUntil" timestamp;--> statement-breakpoint
ALTER TABLE "organizationApiMailAttachment" ADD COLUMN "partIndex" integer;--> statement-breakpoint
ALTER TABLE "organizationApiMailMessage" ADD COLUMN "rawObjectBucket" text;--> statement-breakpoint
ALTER TABLE "organizationApiMailMessage" ADD COLUMN "rawObjectKey" text;--> statement-breakpoint
ALTER TABLE "organizationApiMailMessage" ADD COLUMN "rawObjectProvider" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "attemptedAt" timestamp;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "estimatedCostMicroCents" bigint;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "failureMessage" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "messageHeaderId" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "rawObjectBucket" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "rawObjectKey" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "rawObjectProvider" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "snapshot" jsonb;--> statement-breakpoint
CREATE INDEX "mail_object_cleanup_due_idx" ON "mailObjectCleanup" ("notBefore");--> statement-breakpoint
CREATE INDEX "managed_mail_rule_run_message_idx" ON "managedMailRuleRun" ("mailboxId","messageId");--> statement-breakpoint
CREATE INDEX "organization_api_mail_raw_object_idx" ON "organizationApiMailMessage" ("rawObjectProvider","rawObjectBucket","rawObjectKey");--> statement-breakpoint
CREATE INDEX "organization_mail_send_recovery_idx" ON "organizationMailSendIdempotency" ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "organization_mail_send_raw_object_idx" ON "organizationMailSendIdempotency" ("rawObjectProvider","rawObjectBucket","rawObjectKey");--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_messageId_managedMailMessage_id_fkey" FOREIGN KEY ("messageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_ruleId_managedMailRule_id_fkey" FOREIGN KEY ("ruleId") REFERENCES "managedMailRule"("id") ON DELETE CASCADE;