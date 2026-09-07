ALTER TABLE "mailboxActionExternalEffect" ADD COLUMN "input" jsonb;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD COLUMN "requestHash" text;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ALTER COLUMN "externalId" DROP NOT NULL;