ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "status" text DEFAULT 'completed' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ALTER COLUMN "response" DROP NOT NULL;
