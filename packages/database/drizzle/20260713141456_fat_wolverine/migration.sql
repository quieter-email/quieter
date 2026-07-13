ALTER TABLE "userAiContext" ADD COLUMN "autoLabelModel" text DEFAULT 'deepseek/deepseek-v4-flash' NOT NULL;--> statement-breakpoint
ALTER TABLE "userAiContext" ADD COLUMN "usefulDetailModel" text DEFAULT 'deepseek/deepseek-v4-flash' NOT NULL;--> statement-breakpoint
ALTER TABLE "chatRun" ALTER COLUMN "model" SET DEFAULT 'openai/gpt-5.6-luna';