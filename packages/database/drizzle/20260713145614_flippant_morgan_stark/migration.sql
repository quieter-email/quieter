ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "costUsd" double precision;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "cachedTokens" integer;--> statement-breakpoint
ALTER TABLE "gmailAutoLabelEvent" ADD COLUMN "cacheWriteTokens" integer;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailEvent" ADD COLUMN "costUsd" double precision;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailEvent" ADD COLUMN "cachedTokens" integer;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailEvent" ADD COLUMN "cacheWriteTokens" integer;