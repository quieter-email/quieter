CREATE TABLE "mailboxVerificationCode" (
	"cacheWriteTokens" integer,
	"cachedTokens" integer,
	"completionTokens" integer,
	"costUsd" double precision,
	"createdAt" timestamp NOT NULL,
	"encryptedCode" text,
	"expiresAt" timestamp,
	"id" text PRIMARY KEY,
	"leaseToken" text,
	"leaseUntil" timestamp,
	"mailboxId" text NOT NULL,
	"messageId" text NOT NULL,
	"model" text,
	"processedAt" timestamp,
	"promptTokens" integer,
	"service" text,
	"threadId" text,
	"updatedAt" timestamp NOT NULL,
	"usageReportedAt" timestamp,
	CONSTRAINT "mailbox_verification_code_mailbox_message_unique" UNIQUE("mailboxId","messageId"),
	CONSTRAINT "mailbox_verification_code_payload_check" CHECK ("encryptedCode" is null or ("expiresAt" is not null and "threadId" is not null))
);
--> statement-breakpoint
CREATE INDEX "mailbox_verification_code_mailbox_thread_idx" ON "mailboxVerificationCode" ("mailboxId","threadId","expiresAt");--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD CONSTRAINT "mailboxVerificationCode_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;