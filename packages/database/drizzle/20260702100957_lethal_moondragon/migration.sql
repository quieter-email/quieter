CREATE TABLE "userAiContext" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL CONSTRAINT "user_ai_context_user_id_unique" UNIQUE,
	"markdown" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"lastEditedAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "user_ai_context_markdown_length_check" CHECK (char_length("markdown") <= 12000)
);
--> statement-breakpoint
CREATE TABLE "userAiContextEvent" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"mailboxId" text NOT NULL,
	"organizationId" text NOT NULL,
	"kind" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"mergedAt" timestamp,
	"skippedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "user_ai_context_event_kind_check" CHECK ("kind" in ('auto_label_feedback', 'chat_discovery', 'explicit_preference', 'useful_detail_feedback'))
);
--> statement-breakpoint
CREATE INDEX "mail_auto_label_feedback_mailbox_updated_idx" ON "mailAutoLabelFeedback" ("mailboxId","updatedAt" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "user_ai_context_event_organization_merge_idx" ON "userAiContextEvent" ("organizationId","mergedAt","skippedAt","createdAt");--> statement-breakpoint
CREATE INDEX "user_ai_context_event_user_merge_idx" ON "userAiContextEvent" ("userId","mergedAt","createdAt");--> statement-breakpoint
CREATE INDEX "user_ai_context_event_mailbox_created_idx" ON "userAiContextEvent" ("mailboxId","createdAt");--> statement-breakpoint
ALTER TABLE "userAiContext" ADD CONSTRAINT "userAiContext_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userAiContextEvent" ADD CONSTRAINT "userAiContextEvent_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userAiContextEvent" ADD CONSTRAINT "userAiContextEvent_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userAiContextEvent" ADD CONSTRAINT "userAiContextEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;