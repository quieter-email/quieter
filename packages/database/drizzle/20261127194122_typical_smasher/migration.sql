CREATE TABLE "gmailReplayMetadata" (
	"coverageKey" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"headVersion" bigint NOT NULL,
	"leaseToken" text,
	"mailboxId" text PRIMARY KEY,
	"sealedFacts" text,
	CONSTRAINT "gmail_replay_metadata_payload_size" CHECK (octet_length("sealedFacts") <= 524288),
	CONSTRAINT "gmail_replay_metadata_lease_or_payload" CHECK (("leaseToken" is null) <> ("sealedFacts" is null))
);
--> statement-breakpoint
CREATE TABLE "mailCommandReceipt" (
	"actorUserId" text,
	"claimedAt" timestamp with time zone,
	"mailboxId" text,
	"requestHash" text NOT NULL,
	"requestId" text,
	"result" jsonb,
	CONSTRAINT "mailCommandReceipt_pkey" PRIMARY KEY("actorUserId","mailboxId","requestId")
);
--> statement-breakpoint
CREATE INDEX "mail_command_receipt_mailbox_idx" ON "mailCommandReceipt" ("mailboxId");--> statement-breakpoint
ALTER TABLE "gmailReplayMetadata" ADD CONSTRAINT "gmailReplayMetadata_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailCommandReceipt" ADD CONSTRAINT "mailCommandReceipt_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailCommandReceipt" ADD CONSTRAINT "mailCommandReceipt_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;