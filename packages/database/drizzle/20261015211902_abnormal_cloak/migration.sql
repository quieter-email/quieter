ALTER TABLE "dailyBriefEdition" ADD COLUMN "seenUrgentMessageIds" jsonb;--> statement-breakpoint
ALTER TABLE "dailyBriefSettings" ADD COLUMN "urgentRevision" integer;