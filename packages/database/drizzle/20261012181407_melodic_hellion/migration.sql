-- quieter:contract
CREATE TABLE "mailSnippet" (
	"bodyText" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"name" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mail_snippet_name_length_check" CHECK (char_length("name") between 1 and 120),
	CONSTRAINT "mail_snippet_body_length_check" CHECK (char_length("bodyText") between 1 and 100000)
);
--> statement-breakpoint
DROP TABLE "mailTemplate";--> statement-breakpoint
CREATE INDEX "mail_snippet_mailbox_updated_idx" ON "mailSnippet" ("mailboxId","updatedAt");--> statement-breakpoint
ALTER TABLE "mailSnippet" ADD CONSTRAINT "mailSnippet_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
