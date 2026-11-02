-- quieter:contract
-- Align the new campaign foreign key with organization deletion cascades.
ALTER TABLE "organizationCampaign" DROP CONSTRAINT "organization_campaign_audience_tenant_fk", ADD CONSTRAINT "organization_campaign_audience_tenant_fk" FOREIGN KEY ("organizationId","audienceId") REFERENCES "organizationAudience"("organizationId","id") ON DELETE CASCADE;
