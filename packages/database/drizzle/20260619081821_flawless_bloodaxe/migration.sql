CREATE TABLE "gmailUsefulDetailFeedback" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"detailId" text NOT NULL,
	"kind" text NOT NULL,
	"signal" text NOT NULL,
	"source" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_useful_detail_feedback_mailbox_detail_unique" UNIQUE("mailboxId","detailId"),
	CONSTRAINT "gmail_useful_detail_feedback_signal_check" CHECK ("signal" in ('not_useful', 'useful'))
);
--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD COLUMN "source" text;--> statement-breakpoint
CREATE INDEX "gmail_useful_detail_feedback_profile_idx" ON "gmailUsefulDetailFeedback" ("mailboxId","source","kind","signal");--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailFeedback" ADD CONSTRAINT "gmailUsefulDetailFeedback_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;