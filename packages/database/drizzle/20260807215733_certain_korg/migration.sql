CREATE TABLE IF NOT EXISTS "chatRunStreamChunk" (
	"runId" text NOT NULL,
	"seq" bigint NOT NULL,
	"offset" text NOT NULL,
	"chunk" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "chatRunStreamChunk_pkey" PRIMARY KEY("runId","seq"),
	CONSTRAINT "chat_run_stream_chunk_run_id_offset_unique" UNIQUE("runId","offset")
);
--> statement-breakpoint
ALTER TABLE "chatRun" ADD COLUMN IF NOT EXISTS "streamClosedAt" timestamp;--> statement-breakpoint
DROP INDEX IF EXISTS "chat_run_stream_chunk_run_id_seq_idx";--> statement-breakpoint
DO $$ BEGIN
	ALTER TABLE "chatRunStreamChunk" ADD CONSTRAINT "chatRunStreamChunk_runId_chatRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "chatRun"("id") ON DELETE CASCADE;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;
