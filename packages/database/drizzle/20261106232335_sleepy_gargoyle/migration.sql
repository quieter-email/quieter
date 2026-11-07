-- quieter:contract
ALTER TABLE "semanticIndexRequest" ADD COLUMN "mailImportRequestedAt" timestamp;--> statement-breakpoint
ALTER TABLE "semanticIndexRequest" ADD COLUMN "mailImportedAt" timestamp;--> statement-breakpoint
ALTER TABLE "semanticIndexRequest" ADD COLUMN "mailImportPageToken" text;--> statement-breakpoint
ALTER TABLE "semanticIndexRequest" ADD COLUMN "mailImportPendingIds" jsonb DEFAULT '[]' NOT NULL;