CREATE TABLE "billingEntitlementOverride" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"plan" text NOT NULL,
	"reason" text NOT NULL,
	"createdByUserId" text,
	"expiresAt" timestamp,
	"revokedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rateLimitBucket" (
	"key" text PRIMARY KEY,
	"count" integer NOT NULL,
	"windowStart" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billingOwnerUserId" text;--> statement-breakpoint
CREATE INDEX "billing_entitlement_override_user_id_idx" ON "billingEntitlementOverride" ("userId");--> statement-breakpoint
CREATE INDEX "billing_entitlement_override_active_idx" ON "billingEntitlementOverride" ("userId","revokedAt","expiresAt");--> statement-breakpoint
CREATE INDEX "rate_limit_bucket_expires_at_idx" ON "rateLimitBucket" ("expiresAt");--> statement-breakpoint
ALTER TABLE "billingEntitlementOverride" ADD CONSTRAINT "billingEntitlementOverride_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingEntitlementOverride" ADD CONSTRAINT "billingEntitlementOverride_createdByUserId_user_id_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_billingOwnerUserId_user_id_fkey" FOREIGN KEY ("billingOwnerUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "account" DROP CONSTRAINT "account_userId_user_id_fkey", ADD CONSTRAINT "account_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingSubscription" DROP CONSTRAINT "billingSubscription_userId_user_id_fkey", ADD CONSTRAINT "billingSubscription_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat" DROP CONSTRAINT "chat_userId_user_id_fkey", ADD CONSTRAINT "chat_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_organizationId_organization_id_fkey", ADD CONSTRAINT "invitation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" DROP CONSTRAINT "invitation_inviterId_user_id_fkey", ADD CONSTRAINT "invitation_inviterId_user_id_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailDomain" DROP CONSTRAINT "mailDomain_organizationId_organization_id_fkey", ADD CONSTRAINT "mailDomain_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailbox" DROP CONSTRAINT "mailbox_organizationId_organization_id_fkey", ADD CONSTRAINT "mailbox_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_organizationId_organization_id_fkey", ADD CONSTRAINT "member_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" DROP CONSTRAINT "member_userId_user_id_fkey", ADD CONSTRAINT "member_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailUsageAlertEvent" DROP CONSTRAINT "organizationMailUsageAlertEvent_ROF4Zd0q45Cy_fkey", ADD CONSTRAINT "organizationMailUsageAlertEvent_ROF4Zd0q45Cy_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailUsageEvent" DROP CONSTRAINT "organizationMailUsageEvent_organizationId_organization_id_fkey", ADD CONSTRAINT "organizationMailUsageEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailUsageSettings" DROP CONSTRAINT "organizationMailUsageSettings_HFx0SA0zm7qR_fkey", ADD CONSTRAINT "organizationMailUsageSettings_HFx0SA0zm7qR_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "passkey" DROP CONSTRAINT "passkey_userId_user_id_fkey", ADD CONSTRAINT "passkey_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_activeOrganizationId_organization_id_fkey", ADD CONSTRAINT "session_activeOrganizationId_organization_id_fkey" FOREIGN KEY ("activeOrganizationId") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "session" DROP CONSTRAINT "session_userId_user_id_fkey", ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;