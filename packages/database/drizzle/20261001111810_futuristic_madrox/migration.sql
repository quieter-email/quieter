ALTER TABLE "mailboxVerificationCode" ADD COLUMN "attemptCount" integer;--> statement-breakpoint
ALTER TABLE "mailboxVerificationCode" ADD COLUMN "nextAttemptAt" timestamp;--> statement-breakpoint
CREATE INDEX "mailbox_verification_code_mailbox_retry_idx" ON "mailboxVerificationCode" ("mailboxId","processedAt","nextAttemptAt");