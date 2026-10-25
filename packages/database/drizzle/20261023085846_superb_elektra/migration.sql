CREATE TABLE "mailboxAgentEffect" (
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"inputDigest" text NOT NULL,
	"mailboxId" text NOT NULL,
	"result" jsonb,
	"runId" text NOT NULL,
	"status" text NOT NULL,
	"toolCallId" text NOT NULL,
	"toolId" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_agent_effect_call_unique" UNIQUE("runId","toolCallId")
);
--> statement-breakpoint
CREATE TABLE "mailboxAgentRevision" (
	"createdAt" timestamp NOT NULL,
	"createdByUserId" text NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"manifestDigest" text NOT NULL,
	"specification" jsonb NOT NULL,
	"usage" jsonb,
	"usageReportedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "mailboxAgentRun" (
	"actorUserId" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp NOT NULL,
	"draftId" text,
	"errorMessage" text,
	"finishedAt" timestamp,
	"id" text PRIMARY KEY,
	"invocationKey" text NOT NULL,
	"leaseExpiresAt" timestamp,
	"leaseToken" text,
	"mailboxId" text NOT NULL,
	"messageId" text,
	"privateResult" boolean DEFAULT true NOT NULL,
	"revisionId" text NOT NULL,
	"settingVersion" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"summary" text,
	"threadId" text NOT NULL,
	"triggerKind" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"usage" jsonb,
	"usageReportedAt" timestamp,
	CONSTRAINT "mailbox_agent_run_invocation_unique" UNIQUE("mailboxId","invocationKey"),
	CONSTRAINT "mailbox_agent_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'skipped', 'needs_attention'))
);
--> statement-breakpoint
CREATE TABLE "mailboxAgentSetting" (
	"activationVersion" integer DEFAULT 0 NOT NULL,
	"activatedAt" timestamp,
	"activatedByUserId" text,
	"activeRevisionId" text,
	"createdAt" timestamp NOT NULL,
	"draftRevisionId" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"mailboxId" text PRIMARY KEY,
	"updatedAt" timestamp NOT NULL,
	"version" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mailbox_agent_revision_mailbox_idx" ON "mailboxAgentRevision" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mailbox_agent_run_pending_idx" ON "mailboxAgentRun" ("status","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "mailbox_agent_run_thread_idx" ON "mailboxAgentRun" ("mailboxId","threadId");--> statement-breakpoint
ALTER TABLE "mailboxAgentEffect" ADD CONSTRAINT "mailboxAgentEffect_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentEffect" ADD CONSTRAINT "mailboxAgentEffect_runId_mailboxAgentRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "mailboxAgentRun"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentRevision" ADD CONSTRAINT "mailboxAgentRevision_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentRevision" ADD CONSTRAINT "mailboxAgentRevision_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentRun" ADD CONSTRAINT "mailboxAgentRun_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentRun" ADD CONSTRAINT "mailboxAgentRun_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentRun" ADD CONSTRAINT "mailboxAgentRun_revisionId_mailboxAgentRevision_id_fkey" FOREIGN KEY ("revisionId") REFERENCES "mailboxAgentRevision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAgentSetting" ADD CONSTRAINT "mailboxAgentSetting_activatedByUserId_user_id_fkey" FOREIGN KEY ("activatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxAgentSetting" ADD CONSTRAINT "mailboxAgentSetting_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;