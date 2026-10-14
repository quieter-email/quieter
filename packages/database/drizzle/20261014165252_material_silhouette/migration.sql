CREATE TABLE "gmailComposeOperation" (
	"createdAt" timestamp NOT NULL,
	"draftId" text,
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"mailboxId" text NOT NULL,
	"messageHeaderId" text NOT NULL,
	"operationKey" text NOT NULL,
	"requestHash" text NOT NULL,
	"response" jsonb,
	"status" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_compose_operation_mailbox_key_unique" UNIQUE("mailboxId","operationKey")
);
--> statement-breakpoint
CREATE INDEX "gmail_compose_operation_status_updated_idx" ON "gmailComposeOperation" ("status","updatedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "gmail_compose_operation_active_draft_send_unique" ON "gmailComposeOperation" ("mailboxId","draftId") WHERE "kind" = 'send' and "status" in ('submitting', 'unknown', 'accepted');--> statement-breakpoint
ALTER TABLE "gmailComposeOperation" ADD CONSTRAINT "gmailComposeOperation_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;