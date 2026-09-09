CREATE TABLE "mailSyncBody" (
	"hash" text,
	"lastReferencedSequence" bigint NOT NULL,
	"mailboxId" text,
	"references" integer NOT NULL,
	CONSTRAINT "mailSyncBody_pkey" PRIMARY KEY("mailboxId","hash"),
	CONSTRAINT "mail_sync_body_references_check" CHECK ("references" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mailSyncBody" ADD CONSTRAINT "mailSyncBody_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
