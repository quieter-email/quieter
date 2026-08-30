ALTER TABLE "userAiContext" ALTER COLUMN "autoLabelModel" SET DEFAULT 'google/gemini-3.5-flash-lite';--> statement-breakpoint
ALTER TABLE "userAiContext" ALTER COLUMN "usefulDetailModel" SET DEFAULT 'google/gemini-3.5-flash-lite';--> statement-breakpoint
UPDATE "userAiContext"
SET "autoLabelModel" = 'google/gemini-3.5-flash-lite'
WHERE "autoLabelModel" = 'openai/gpt-5.6-luna';--> statement-breakpoint
UPDATE "userAiContext"
SET "usefulDetailModel" = 'google/gemini-3.5-flash-lite'
WHERE "usefulDetailModel" = 'openai/gpt-5.6-luna';
