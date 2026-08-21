-- quieter:contract
DROP TABLE "chatRun";--> statement-breakpoint
DELETE FROM "chat";--> statement-breakpoint
ALTER TABLE "chatMessage" ADD COLUMN "generationId" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_message_one_streaming_per_chat" ON "chatMessage" ("chatId") WHERE "status" = 'streaming';
