CREATE TABLE "mailboxChangeHead" (
	"mailboxId" text PRIMARY KEY,
	"version" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailboxChangeJournal" (
	"changes" jsonb NOT NULL,
	"contentRevision" bigint,
	"mailboxId" text,
	"recipientUserIds" jsonb,
	"version" bigint,
	CONSTRAINT "mailboxChangeJournal_pkey" PRIMARY KEY("mailboxId","version")
);
--> statement-breakpoint
ALTER TABLE "mailboxChangeHead" ADD CONSTRAINT "mailboxChangeHead_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxChangeJournal" ADD CONSTRAINT "mailboxChangeJournal_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;