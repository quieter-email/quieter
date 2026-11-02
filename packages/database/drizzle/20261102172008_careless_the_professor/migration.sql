ALTER TABLE "organizationAudience" ADD COLUMN "unsubscribePolicy" jsonb;--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD COLUMN "unsubscribeOverride" jsonb;--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD COLUMN "unsubscribeSnapshot" jsonb;