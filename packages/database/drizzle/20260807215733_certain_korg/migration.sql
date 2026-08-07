CREATE TABLE "chatRunStreamChunk" (
	"runId" text,
	"seq" bigint,
	"offset" text NOT NULL,
	"chunk" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "chatRunStreamChunk_pkey" PRIMARY KEY("runId","seq"),
	CONSTRAINT "chat_run_stream_chunk_run_id_offset_unique" UNIQUE("runId","offset")
);
--> statement-breakpoint
ALTER TABLE "chatRun" ADD COLUMN "streamClosedAt" timestamp;--> statement-breakpoint
CREATE INDEX "chat_run_stream_chunk_run_id_seq_idx" ON "chatRunStreamChunk" ("runId","seq");--> statement-breakpoint
ALTER TABLE "chatRunStreamChunk" ADD CONSTRAINT "chatRunStreamChunk_runId_chatRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "chatRun"("id") ON DELETE CASCADE;