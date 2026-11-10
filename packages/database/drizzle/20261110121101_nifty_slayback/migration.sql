CREATE TABLE "gmailMessageWork" (
	"actionsCompletedAt" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"dueAt" timestamp NOT NULL,
	"gmailMessageId" text NOT NULL,
	"id" text PRIMARY KEY,
	"lastError" text,
	"leaseToken" text,
	"leaseUntil" timestamp,
	"mailboxId" text NOT NULL,
	"notificationReceivedAt" timestamp,
	"position" integer DEFAULT 0 NOT NULL,
	"priorityAt" timestamp NOT NULL,
	"source" text NOT NULL,
	"triggerActions" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_message_work_mailbox_message_unique" UNIQUE("mailboxId","gmailMessageId"),
	CONSTRAINT "gmail_message_work_source_check" CHECK ("source" in ('fresh', 'catchup'))
);
--> statement-breakpoint
ALTER TABLE "gmailWatchState" ADD COLUMN "processingWorkLeaseId" text;--> statement-breakpoint
CREATE INDEX "gmail_message_work_ready_idx" ON "gmailMessageWork" ("source","dueAt","priorityAt");--> statement-breakpoint
CREATE INDEX "gmail_message_work_mailbox_lease_idx" ON "gmailMessageWork" ("mailboxId","leaseUntil");--> statement-breakpoint
ALTER TABLE "gmailMessageWork" ADD CONSTRAINT "gmailMessageWork_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;