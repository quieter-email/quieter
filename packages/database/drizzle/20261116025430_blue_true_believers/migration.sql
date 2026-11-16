ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "privateContextUserId" text;--> statement-breakpoint
ALTER TABLE "scheduledMailSend" ADD COLUMN "cancellationOrigin" jsonb;