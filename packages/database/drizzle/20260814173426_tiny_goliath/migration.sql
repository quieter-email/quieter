CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
ALTER TABLE "aiMemory" ADD COLUMN "embeddedAt" timestamp;--> statement-breakpoint
ALTER TABLE "aiMemory" ADD COLUMN "embedding" vector(1024);--> statement-breakpoint
CREATE INDEX "ai_memory_embedding_pending_idx" ON "aiMemory" ("scopeKey","updatedAt") WHERE "status" = 'active' and "embedding" is null;--> statement-breakpoint
CREATE INDEX "ai_memory_embedding_idx" ON "aiMemory" USING hnsw ("embedding" vector_cosine_ops) WHERE "status" = 'active';