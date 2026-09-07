ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "definition" jsonb;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "leaseId" text;--> statement-breakpoint
ALTER TABLE "managedMailRuleBackfill" ADD COLUMN "leasedUntil" timestamp;