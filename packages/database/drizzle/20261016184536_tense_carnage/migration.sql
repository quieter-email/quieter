ALTER TABLE "dailyBriefSettings" ADD COLUMN "cadence" text;--> statement-breakpoint
ALTER TABLE "dailyBriefSettings" ADD COLUMN "lastUsedAt" timestamp;--> statement-breakpoint
ALTER TABLE "dailyBriefSettings" ADD COLUMN "weekday" integer;