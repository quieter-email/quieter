CREATE TABLE "aiGeneratedMailBody" (
	"bodyDigest" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"mailboxId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "ai_generated_mail_body_mailbox_user_digest_unique" UNIQUE("mailboxId","userId","bodyDigest"),
	CONSTRAINT "ai_generated_mail_body_digest_check" CHECK ("bodyDigest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "aiMemoryMailboxState" (
	"createdAt" timestamp NOT NULL,
	"lastError" text,
	"mailboxId" text PRIMARY KEY,
	"processingAt" timestamp,
	"receivedComplete" boolean DEFAULT false NOT NULL,
	"receivedCount" integer DEFAULT 0 NOT NULL,
	"receivedCursor" text,
	"sentComplete" boolean DEFAULT false NOT NULL,
	"sentCount" integer DEFAULT 0 NOT NULL,
	"sentCursor" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"userId" text,
	CONSTRAINT "ai_memory_mailbox_state_status_check" CHECK ("status" in ('pending', 'processing', 'completed', 'failed')),
	CONSTRAINT "ai_memory_mailbox_state_count_check" CHECK ("receivedCount" >= 0 and "sentCount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_generated_mail_body_mailbox_digest_idx" ON "aiGeneratedMailBody" ("mailboxId","bodyDigest");--> statement-breakpoint
CREATE INDEX "ai_generated_mail_body_expiration_idx" ON "aiGeneratedMailBody" ("expiresAt");--> statement-breakpoint
CREATE INDEX "ai_memory_scope_category_idx" ON "aiMemory" ("scopeKey",("metadata"->>'category'));--> statement-breakpoint
CREATE INDEX "ai_memory_metadata_idx" ON "aiMemory" USING gin ("metadata");--> statement-breakpoint
CREATE INDEX "ai_memory_text_idx" ON "aiMemory" USING gin (to_tsvector('simple', "content" || ' ' || "summary"));--> statement-breakpoint
CREATE INDEX "ai_memory_mailbox_state_status_updated_idx" ON "aiMemoryMailboxState" ("status","updatedAt");--> statement-breakpoint
ALTER TABLE "aiGeneratedMailBody" ADD CONSTRAINT "aiGeneratedMailBody_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiGeneratedMailBody" ADD CONSTRAINT "aiGeneratedMailBody_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryMailboxState" ADD CONSTRAINT "aiMemoryMailboxState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryMailboxState" ADD CONSTRAINT "aiMemoryMailboxState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;