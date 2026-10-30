-- quieter:contract
ALTER TABLE "mailDomain" ADD CONSTRAINT "mail_domain_organization_domain_unique" UNIQUE("organizationId","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "mail_domain_owner_unique" ON "mailDomain" ("domain") WHERE "ownershipVerifiedAt" is not null or "status" = 'verified';
