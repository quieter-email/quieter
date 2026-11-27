CREATE TABLE "mailboxLabelOrganization" (
	"mailboxId" text PRIMARY KEY,
	"organization" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "suggestedLabelIds" jsonb;--> statement-breakpoint
ALTER TABLE "mailboxLabelOrganization" ADD CONSTRAINT "mailboxLabelOrganization_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;