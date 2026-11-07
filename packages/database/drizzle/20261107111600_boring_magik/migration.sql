CREATE TABLE "gmailMessageOpenTracking" (
	"composeOperationId" text PRIMARY KEY,
	"createdAt" timestamp NOT NULL,
	"firstLoadedAt" timestamp,
	"lastLoadedAt" timestamp,
	"mailboxId" text NOT NULL,
	"messageHeaderId" text NOT NULL CONSTRAINT "gmail_message_open_tracking_header_unique" UNIQUE,
	"messageId" text,
	"recipient" text,
	"reportedLoadCount" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "gmail_message_open_tracking_mailbox_message_unique" UNIQUE("mailboxId","messageId")
);
--> statement-breakpoint
ALTER TABLE "gmailMessageOpenTracking" ADD CONSTRAINT "gmailMessageOpenTracking_KayyKEr3YBsF_fkey" FOREIGN KEY ("composeOperationId") REFERENCES "gmailComposeOperation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailMessageOpenTracking" ADD CONSTRAINT "gmailMessageOpenTracking_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;