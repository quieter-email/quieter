CREATE TABLE "gmailLabel" (
	"mailboxId" text NOT NULL,
	"labelId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"inclusionCriteria" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_label_mailbox_id_label_id_unique" UNIQUE("mailboxId","labelId")
);
--> statement-breakpoint
CREATE INDEX "gmail_label_mailbox_id_idx" ON "gmailLabel" ("mailboxId");--> statement-breakpoint
ALTER TABLE "gmailLabel" ADD CONSTRAINT "gmailLabel_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;