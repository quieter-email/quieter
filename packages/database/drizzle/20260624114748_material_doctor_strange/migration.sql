ALTER TABLE "managedMailMessage" ADD COLUMN "rawObjectProvider" text;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "rawObjectBucket" text;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "rawObjectKey" text;--> statement-breakpoint
CREATE INDEX "managed_mail_message_raw_object_idx" ON "managedMailMessage" ("rawObjectProvider","rawObjectBucket","rawObjectKey");--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD CONSTRAINT "managed_mail_message_raw_object_provider_check" CHECK ("rawObjectProvider" is null or "rawObjectProvider" in ('r2', 's3'));