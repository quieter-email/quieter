CREATE TABLE "mailboxAction" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdByUserId" text,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'ready' NOT NULL,
	"statusReason" text,
	"draftRevisionId" text,
	"publishedRevisionId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_status_check" CHECK ("status" in ('ready', 'needs_attention'))
);
--> statement-breakpoint
CREATE TABLE "mailboxActionExternalEffect" (
	"id" text PRIMARY KEY,
	"runId" text NOT NULL,
	"stepRunId" text,
	"actionId" text NOT NULL,
	"revisionId" text NOT NULL,
	"provider" text NOT NULL,
	"connectorCredentialId" text,
	"idempotencyKey" text NOT NULL CONSTRAINT "mailbox_action_external_effect_idempotency_unique" UNIQUE,
	"externalId" text NOT NULL,
	"externalUrl" text,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_external_effect_provider_check" CHECK ("provider" in ('linear'))
);
--> statement-breakpoint
CREATE TABLE "mailboxActionRevision" (
	"id" text PRIMARY KEY,
	"actionId" text NOT NULL,
	"revisionNumber" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"validationStatus" text DEFAULT 'invalid' NOT NULL,
	"validationErrors" jsonb DEFAULT '[]' NOT NULL,
	"createdByUserId" text,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_revision_action_number_unique" UNIQUE("actionId","revisionNumber"),
	CONSTRAINT "mailbox_action_revision_validation_status_check" CHECK ("validationStatus" in ('valid', 'invalid'))
);
--> statement-breakpoint
CREATE TABLE "mailboxActionRun" (
	"id" text PRIMARY KEY,
	"actionId" text NOT NULL,
	"revisionId" text NOT NULL,
	"mailboxId" text NOT NULL,
	"organizationId" text NOT NULL,
	"triggerNodeId" text NOT NULL,
	"sourceMessageId" text NOT NULL,
	"sourceThreadId" text,
	"dedupeKey" text NOT NULL CONSTRAINT "mailbox_action_run_dedupe_key_unique" UNIQUE,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"leasedUntil" timestamp,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "mailboxActionRunFrame" (
	"id" text PRIMARY KEY,
	"runId" text NOT NULL,
	"parentFrameId" text,
	"status" text DEFAULT 'running' NOT NULL,
	"path" jsonb DEFAULT '[]' NOT NULL,
	"variables" jsonb DEFAULT '{}' NOT NULL,
	"mergeState" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_run_frame_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_attention', 'needs_review'))
);
--> statement-breakpoint
CREATE TABLE "mailboxActionStepRun" (
	"id" text PRIMARY KEY,
	"runId" text NOT NULL,
	"frameId" text,
	"nodeId" text NOT NULL,
	"nodeType" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"input" jsonb DEFAULT '{}' NOT NULL,
	"output" jsonb,
	"model" text,
	"toolCalls" jsonb,
	"error" text,
	"startedAt" timestamp,
	"completedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_action_step_run_status_check" CHECK ("status" in ('queued', 'running', 'succeeded', 'skipped', 'failed', 'needs_review'))
);
--> statement-breakpoint
ALTER TABLE "connectorCredential" DROP CONSTRAINT "connector_credential_user_provider_unique";--> statement-breakpoint
ALTER TABLE "connectorCredential" ADD COLUMN "providerWorkspaceId" text;--> statement-breakpoint
ALTER TABLE "connectorCredential" ADD COLUMN "providerWorkspaceName" text;--> statement-breakpoint
ALTER TABLE "connectorCredential" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "connectorCredential" ADD CONSTRAINT "connector_credential_user_provider_account_unique" UNIQUE("userId","provider","providerAccountId");--> statement-breakpoint
CREATE INDEX "connector_credential_user_provider_idx" ON "connectorCredential" ("userId","provider");--> statement-breakpoint
CREATE INDEX "mailbox_action_mailbox_id_idx" ON "mailboxAction" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mailbox_action_organization_id_idx" ON "mailboxAction" ("organizationId");--> statement-breakpoint
CREATE INDEX "mailbox_action_published_enabled_idx" ON "mailboxAction" ("mailboxId","enabled","publishedRevisionId");--> statement-breakpoint
CREATE INDEX "mailbox_action_external_effect_action_created_idx" ON "mailboxActionExternalEffect" ("actionId","createdAt");--> statement-breakpoint
CREATE INDEX "mailbox_action_external_effect_run_id_idx" ON "mailboxActionExternalEffect" ("runId");--> statement-breakpoint
CREATE INDEX "mailbox_action_revision_action_id_idx" ON "mailboxActionRevision" ("actionId");--> statement-breakpoint
CREATE INDEX "mailbox_action_run_action_created_idx" ON "mailboxActionRun" ("actionId","createdAt");--> statement-breakpoint
CREATE INDEX "mailbox_action_run_mailbox_created_idx" ON "mailboxActionRun" ("mailboxId","createdAt");--> statement-breakpoint
CREATE INDEX "mailbox_action_run_status_lease_idx" ON "mailboxActionRun" ("status","leasedUntil");--> statement-breakpoint
CREATE INDEX "mailbox_action_run_frame_run_id_idx" ON "mailboxActionRunFrame" ("runId");--> statement-breakpoint
CREATE INDEX "mailbox_action_step_run_run_id_idx" ON "mailboxActionStepRun" ("runId");--> statement-breakpoint
CREATE INDEX "mailbox_action_step_run_frame_id_idx" ON "mailboxActionStepRun" ("frameId");--> statement-breakpoint
ALTER TABLE "mailboxAction" ADD CONSTRAINT "mailboxAction_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAction" ADD CONSTRAINT "mailboxAction_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAction" ADD CONSTRAINT "mailboxAction_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD CONSTRAINT "mailboxActionExternalEffect_runId_mailboxActionRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "mailboxActionRun"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD CONSTRAINT "mailboxActionExternalEffect_z30vRB4MGaFd_fkey" FOREIGN KEY ("stepRunId") REFERENCES "mailboxActionStepRun"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD CONSTRAINT "mailboxActionExternalEffect_actionId_mailboxAction_id_fkey" FOREIGN KEY ("actionId") REFERENCES "mailboxAction"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD CONSTRAINT "mailboxActionExternalEffect_envh3iCq9DLB_fkey" FOREIGN KEY ("revisionId") REFERENCES "mailboxActionRevision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionExternalEffect" ADD CONSTRAINT "mailboxActionExternalEffect_c1WaeE5H7a7J_fkey" FOREIGN KEY ("connectorCredentialId") REFERENCES "connectorCredential"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxActionRevision" ADD CONSTRAINT "mailboxActionRevision_actionId_mailboxAction_id_fkey" FOREIGN KEY ("actionId") REFERENCES "mailboxAction"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionRevision" ADD CONSTRAINT "mailboxActionRevision_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxActionRun" ADD CONSTRAINT "mailboxActionRun_actionId_mailboxAction_id_fkey" FOREIGN KEY ("actionId") REFERENCES "mailboxAction"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionRun" ADD CONSTRAINT "mailboxActionRun_revisionId_mailboxActionRevision_id_fkey" FOREIGN KEY ("revisionId") REFERENCES "mailboxActionRevision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionRun" ADD CONSTRAINT "mailboxActionRun_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionRun" ADD CONSTRAINT "mailboxActionRun_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionRunFrame" ADD CONSTRAINT "mailboxActionRunFrame_runId_mailboxActionRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "mailboxActionRun"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionStepRun" ADD CONSTRAINT "mailboxActionStepRun_runId_mailboxActionRun_id_fkey" FOREIGN KEY ("runId") REFERENCES "mailboxActionRun"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxActionStepRun" ADD CONSTRAINT "mailboxActionStepRun_frameId_mailboxActionRunFrame_id_fkey" FOREIGN KEY ("frameId") REFERENCES "mailboxActionRunFrame"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "connectorCredential" DROP CONSTRAINT "connector_credential_provider_check", ADD CONSTRAINT "connector_credential_provider_check" CHECK ("provider" in ('google_calendar', 'linear'));--> statement-breakpoint
ALTER TABLE "connectorOAuthState" DROP CONSTRAINT "connector_oauth_state_provider_check", ADD CONSTRAINT "connector_oauth_state_provider_check" CHECK ("provider" in ('google_calendar', 'linear'));