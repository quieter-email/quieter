CREATE TABLE "organizationAudience" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_audience_org_id_unique" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE TABLE "organizationAudienceLifecycleEvent" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"audienceId" text NOT NULL,
	"membershipId" text NOT NULL,
	"contactId" text NOT NULL,
	"eventType" text NOT NULL,
	"occurredAt" timestamp NOT NULL,
	"recordedAt" timestamp NOT NULL,
	"actorType" text NOT NULL,
	"actorId" text,
	"channel" text NOT NULL,
	"source" text NOT NULL,
	"reason" text,
	"beforeStatus" text,
	"afterStatus" text NOT NULL,
	"applied" boolean NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizationAudienceMembership" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"audienceId" text NOT NULL,
	"contactId" text NOT NULL,
	"status" text NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"consentSource" text NOT NULL,
	"consentOccurredAt" timestamp NOT NULL,
	"lastLifecycleOccurredAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_audience_membership_contact_unique" UNIQUE("organizationId","audienceId","contactId"),
	CONSTRAINT "organization_audience_membership_scope_id_unique" UNIQUE("organizationId","audienceId","id"),
	CONSTRAINT "organization_audience_membership_status_check" CHECK ("status" in ('subscribed', 'unsubscribed', 'removed'))
);
--> statement-breakpoint
CREATE TABLE "organizationAudienceOperation" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"operation" text NOT NULL,
	"inputHash" text NOT NULL,
	"result" jsonb,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "organization_audience_operation_key_unique" UNIQUE("organizationId","idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "organizationAudienceSegment" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"audienceId" text NOT NULL,
	"name" text NOT NULL,
	"criteria" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_audience_segment_scope_id_unique" UNIQUE("organizationId","audienceId","id")
);
--> statement-breakpoint
CREATE TABLE "organizationCampaign" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"audienceId" text NOT NULL,
	"segmentIds" jsonb DEFAULT '[]' NOT NULL,
	"name" text NOT NULL,
	"from" text NOT NULL,
	"subject" text NOT NULL,
	"text" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"selectionSnapshot" jsonb,
	"sendKey" text,
	"sendRequestHash" text,
	"leaseToken" text,
	"leaseExpiresAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"sentAt" timestamp,
	CONSTRAINT "organization_campaign_tenant_id_unique" UNIQUE("organizationId","id"),
	CONSTRAINT "organization_campaign_send_key_unique" UNIQUE("organizationId","sendKey"),
	CONSTRAINT "organization_campaign_status_check" CHECK ("status" in ('draft','queued','sending','completed','canceled','paused'))
);
--> statement-breakpoint
CREATE TABLE "organizationCampaignRecipient" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"campaignId" text NOT NULL,
	"membershipId" text NOT NULL,
	"contactId" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"tags" jsonb NOT NULL,
	"subscriptionStatus" text NOT NULL,
	"exclusionReason" text,
	"status" text NOT NULL,
	"unsubscribeToken" text NOT NULL CONSTRAINT "organization_campaign_unsubscribe_token_unique" UNIQUE,
	"sendKey" text NOT NULL CONSTRAINT "organization_campaign_recipient_send_key_unique" UNIQUE,
	"providerMessageId" text,
	"sendOperationId" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_campaign_recipient_email_unique" UNIQUE("campaignId","email"),
	CONSTRAINT "organization_campaign_recipient_status_check" CHECK ("status" in ('pending','sending','sent','uncertain','failed','excluded','canceled'))
);
--> statement-breakpoint
CREATE TABLE "organizationContact" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_contact_org_email_unique" UNIQUE("organizationId","email"),
	CONSTRAINT "organization_contact_org_id_unique" UNIQUE("organizationId","id")
);
--> statement-breakpoint
CREATE INDEX "organization_audience_org_name_idx" ON "organizationAudience" ("organizationId","name");--> statement-breakpoint
CREATE INDEX "organization_audience_event_history_idx" ON "organizationAudienceLifecycleEvent" ("organizationId","audienceId","recordedAt","id");--> statement-breakpoint
CREATE INDEX "organization_audience_event_membership_idx" ON "organizationAudienceLifecycleEvent" ("organizationId","audienceId","membershipId","recordedAt");--> statement-breakpoint
CREATE INDEX "organization_audience_membership_status_idx" ON "organizationAudienceMembership" ("organizationId","audienceId","status","id");--> statement-breakpoint
CREATE INDEX "organization_audience_membership_tags_idx" ON "organizationAudienceMembership" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "organization_audience_segment_audience_idx" ON "organizationAudienceSegment" ("organizationId","audienceId");--> statement-breakpoint
CREATE INDEX "organization_campaign_queue_idx" ON "organizationCampaign" ("status","leaseExpiresAt");--> statement-breakpoint
CREATE INDEX "organization_campaign_list_idx" ON "organizationCampaign" ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "organization_campaign_recipient_work_idx" ON "organizationCampaignRecipient" ("campaignId","status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "organization_contact_org_name_idx" ON "organizationContact" ("organizationId","name");--> statement-breakpoint
ALTER TABLE "organizationAudience" ADD CONSTRAINT "organizationAudience_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceLifecycleEvent" ADD CONSTRAINT "organizationAudienceLifecycleEvent_lYZwT25n1fJu_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceLifecycleEvent" ADD CONSTRAINT "organization_audience_event_membership_fk" FOREIGN KEY ("organizationId","audienceId","membershipId") REFERENCES "organizationAudienceMembership"("organizationId","audienceId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceLifecycleEvent" ADD CONSTRAINT "organization_audience_event_contact_fk" FOREIGN KEY ("organizationId","contactId") REFERENCES "organizationContact"("organizationId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceMembership" ADD CONSTRAINT "organizationAudienceMembership_bPVYrsPFcxfA_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceMembership" ADD CONSTRAINT "organization_audience_membership_audience_fk" FOREIGN KEY ("organizationId","audienceId") REFERENCES "organizationAudience"("organizationId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceMembership" ADD CONSTRAINT "organization_audience_membership_contact_fk" FOREIGN KEY ("organizationId","contactId") REFERENCES "organizationContact"("organizationId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceOperation" ADD CONSTRAINT "organizationAudienceOperation_p4hBOBAANeWv_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceSegment" ADD CONSTRAINT "organizationAudienceSegment_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationAudienceSegment" ADD CONSTRAINT "organization_audience_segment_audience_fk" FOREIGN KEY ("organizationId","audienceId") REFERENCES "organizationAudience"("organizationId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD CONSTRAINT "organizationCampaign_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD CONSTRAINT "organization_campaign_audience_tenant_fk" FOREIGN KEY ("organizationId","audienceId") REFERENCES "organizationAudience"("organizationId","id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "organizationCampaignRecipient" ADD CONSTRAINT "organization_campaign_recipient_tenant_fk" FOREIGN KEY ("organizationId","campaignId") REFERENCES "organizationCampaign"("organizationId","id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationContact" ADD CONSTRAINT "organizationContact_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;