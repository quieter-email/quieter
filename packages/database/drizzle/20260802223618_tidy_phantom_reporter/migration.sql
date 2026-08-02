ALTER TABLE "mailbox" ADD COLUMN "signatureHtml" text;--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "signatureText" text;--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD COLUMN "conditionGroups" jsonb;--> statement-breakpoint
ALTER TABLE "managedMailRule" ADD COLUMN "actions" jsonb;--> statement-breakpoint
ALTER TABLE "managedMailRuleApplication" ADD COLUMN "explanation" text;--> statement-breakpoint
ALTER TABLE "managedMailRuleApplication" ADD COLUMN "actionResults" jsonb;