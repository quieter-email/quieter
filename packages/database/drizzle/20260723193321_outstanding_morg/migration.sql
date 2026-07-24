CREATE TABLE "mailDomainConnectAttempt" (
	"id" text PRIMARY KEY,
	"domainId" text NOT NULL,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"mode" text NOT NULL,
	"providerId" text NOT NULL,
	"providerName" text NOT NULL,
	"serviceId" text NOT NULL,
	"templateVersion" integer NOT NULL,
	"status" text NOT NULL,
	"callbackError" text,
	"expiresAt" timestamp NOT NULL,
	"consumedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mail_domain_connect_attempt_mode_check" CHECK ("mode" in ('send_only', 'send_and_receive')),
	CONSTRAINT "mail_domain_connect_attempt_status_check" CHECK ("status" in ('pending', 'returned', 'canceled', 'failed', 'expired'))
);
--> statement-breakpoint
ALTER TABLE "mailDomain" ADD COLUMN "mode" text DEFAULT 'send_and_receive' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailDomain" ADD COLUMN "modeUpdatedAt" timestamp;--> statement-breakpoint
ALTER TABLE "mailDomain" ADD COLUMN "modeUpdatedByUserId" text;--> statement-breakpoint
CREATE INDEX "mail_domain_connect_attempt_domain_idx" ON "mailDomainConnectAttempt" ("domainId","createdAt");--> statement-breakpoint
CREATE INDEX "mail_domain_connect_attempt_expiry_idx" ON "mailDomainConnectAttempt" ("expiresAt");--> statement-breakpoint
CREATE INDEX "mail_domain_connect_attempt_user_idx" ON "mailDomainConnectAttempt" ("userId");--> statement-breakpoint
ALTER TABLE "mailDomain" ADD CONSTRAINT "mailDomain_modeUpdatedByUserId_user_id_fkey" FOREIGN KEY ("modeUpdatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailDomainConnectAttempt" ADD CONSTRAINT "mailDomainConnectAttempt_domainId_mailDomain_id_fkey" FOREIGN KEY ("domainId") REFERENCES "mailDomain"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailDomainConnectAttempt" ADD CONSTRAINT "mailDomainConnectAttempt_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailDomainConnectAttempt" ADD CONSTRAINT "mailDomainConnectAttempt_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailDomain" ADD CONSTRAINT "mail_domain_mode_check" CHECK ("mode" in ('send_only', 'send_and_receive'));