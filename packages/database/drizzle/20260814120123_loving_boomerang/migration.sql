CREATE TABLE "aiMemoryIndexJob" (
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"lastError" text,
	"memoryId" text NOT NULL CONSTRAINT "ai_memory_index_job_memory_unique" UNIQUE,
	"operation" text NOT NULL,
	"processingAt" timestamp,
	"status" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "ai_memory_index_job_operation_check" CHECK ("operation" in ('delete', 'upsert')),
	CONSTRAINT "ai_memory_index_job_status_check" CHECK ("status" in ('completed', 'failed', 'pending', 'processing')),
	CONSTRAINT "ai_memory_index_job_attempt_count_check" CHECK ("attemptCount" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_memory_index_job_status_available_idx" ON "aiMemoryIndexJob" ("status","availableAt");
--> statement-breakpoint
INSERT INTO "aiMemoryIndexJob" (
	"attemptCount",
	"availableAt",
	"createdAt",
	"id",
	"memoryId",
	"operation",
	"status",
	"updatedAt"
)
SELECT
	0,
	CURRENT_TIMESTAMP,
	CURRENT_TIMESTAMP,
	'backfill:' || "id",
	"id",
	'upsert',
	'pending',
	CURRENT_TIMESTAMP
FROM "aiMemory"
WHERE "status" = 'active';
