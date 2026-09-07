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
CREATE INDEX "organization_api_mail_raw_object_idx" ON "organizationApiMailMessage" ("rawObjectProvider","rawObjectBucket","rawObjectKey");--> statement-breakpoint
CREATE INDEX "organization_mail_send_recovery_idx" ON "organizationMailSendIdempotency" ("status","updatedAt");--> statement-breakpoint
CREATE INDEX "organization_mail_send_raw_object_idx" ON "organizationMailSendIdempotency" ("rawObjectProvider","rawObjectBucket","rawObjectKey");