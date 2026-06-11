CREATE TABLE "chatRun" (
	"id" text PRIMARY KEY,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"assistantMessageId" text NOT NULL,
	"status" text NOT NULL,
	"mailboxId" text NOT NULL,
	"mailboxCategory" text NOT NULL,
	"cancelRequestedAt" timestamp,
	"lastHeartbeatAt" timestamp,
	"error" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chatMessage" ADD COLUMN "status" text DEFAULT 'complete' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatMessage" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "termsAcceptedAt" timestamp;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_id_mailbox_id_user_id_unique" UNIQUE("id","mailboxId","userId");--> statement-breakpoint
ALTER TABLE "chatMessage" ADD CONSTRAINT "chat_message_id_chat_id_unique" UNIQUE("id","chatId");--> statement-breakpoint
CREATE INDEX "chat_run_chat_id_status_idx" ON "chatRun" ("chatId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_one_active_per_chat" ON "chatRun" ("chatId") WHERE "status" in ('queued', 'running', 'waiting_on_tool');--> statement-breakpoint
ALTER TABLE "chatRun" ADD CONSTRAINT "chat_run_assistant_message_id_chat_id_fkey" FOREIGN KEY ("assistantMessageId","chatId") REFERENCES "chatMessage"("id","chatId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chatRun" ADD CONSTRAINT "chat_run_chat_id_mailbox_id_user_id_fkey" FOREIGN KEY ("chatId","mailboxId","userId") REFERENCES "chat"("id","mailboxId","userId") ON DELETE CASCADE;