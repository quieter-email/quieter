-- quieter:contract
-- Chat turns are no longer resumable across requests; the assistant row is written once when a turn finishes.
DROP INDEX "chat_message_one_streaming_per_chat";--> statement-breakpoint
ALTER TABLE "chatMessage" DROP COLUMN "error";--> statement-breakpoint
ALTER TABLE "chatMessage" DROP COLUMN "generationId";--> statement-breakpoint
ALTER TABLE "chatMessage" DROP COLUMN "status";