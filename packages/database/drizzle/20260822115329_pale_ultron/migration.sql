ALTER TABLE "mailDomain" ADD COLUMN "catchAllMailboxId" text;--> statement-breakpoint
ALTER TABLE "mailDomain" ADD CONSTRAINT "mail_domain_catch_all_mailbox_unique" UNIQUE("catchAllMailboxId");--> statement-breakpoint
CREATE INDEX "mail_domain_catch_all_mailbox_idx" ON "mailDomain" ("catchAllMailboxId");--> statement-breakpoint
ALTER TABLE "mailDomain" ADD CONSTRAINT "mailDomain_catchAllMailboxId_mailbox_id_fkey" FOREIGN KEY ("catchAllMailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;