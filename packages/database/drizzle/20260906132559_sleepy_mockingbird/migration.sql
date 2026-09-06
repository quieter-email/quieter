CREATE TABLE "mailSendCapacity" (
	"key" text PRIMARY KEY,
	"region" text NOT NULL,
	"max24HourSend" bigint NOT NULL,
	"maxSendRate" double precision NOT NULL,
	"sentLast24Hours" bigint NOT NULL,
	"observedAt" timestamp with time zone NOT NULL,
	"nextSendAt" timestamp with time zone NOT NULL,
	"sendingEnabled" boolean NOT NULL,
	CONSTRAINT "mail_send_capacity_bounds_check" CHECK ("max24HourSend" >= 0 AND "maxSendRate" >= 0 AND "sentLast24Hours" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mailSendAttempt" ADD COLUMN "capacityKey" text;--> statement-breakpoint
ALTER TABLE "mailSendAttempt" ADD COLUMN "recipientCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "mail_attempt_capacity_window_idx" ON "mailSendAttempt" ("capacityKey","intentAt") WHERE "capacityKey" IS NOT NULL AND "outcome" <> 'rejected';--> statement-breakpoint
ALTER TABLE "mailSendAttempt" ADD CONSTRAINT "mailSendAttempt_capacityKey_mailSendCapacity_key_fkey" FOREIGN KEY ("capacityKey") REFERENCES "mailSendCapacity"("key") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailSendAttempt" ADD CONSTRAINT "mail_attempt_capacity_check" CHECK (("capacityKey" IS NULL AND "recipientCount" = 0) OR ("capacityKey" IS NOT NULL AND "recipientCount" BETWEEN 1 AND 50));--> statement-breakpoint
ALTER TABLE "mailSubmissionOutbox" DROP CONSTRAINT "mail_outbox_event_check", ADD CONSTRAINT "mail_outbox_event_check" CHECK ("eventType" IN ('submission.dispatch', 'submission.accepted', 'submission.failed') AND "schemaVersion" > 0);