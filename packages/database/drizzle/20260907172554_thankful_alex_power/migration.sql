CREATE TABLE "managedMailRuleRun" (
	"actionResults" jsonb NOT NULL,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"definition" jsonb NOT NULL,
	"error" text,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"matched" boolean NOT NULL,
	"messageId" text NOT NULL,
	"revision" text NOT NULL,
	"ruleId" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_rule_run_revision_unique" UNIQUE("ruleId","messageId","revision")
);
--> statement-breakpoint
CREATE INDEX "managed_mail_rule_run_message_idx" ON "managedMailRuleRun" ("mailboxId","messageId");--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_messageId_managedMailMessage_id_fkey" FOREIGN KEY ("messageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailRuleRun" ADD CONSTRAINT "managedMailRuleRun_ruleId_managedMailRule_id_fkey" FOREIGN KEY ("ruleId") REFERENCES "managedMailRule"("id") ON DELETE CASCADE;