-- quieter:contract
CREATE TABLE "billingAccountSettings" (
	"activatedAt" timestamp,
	"checkoutAttemptId" text,
	"checkoutExpiresAt" timestamp,
	"checkoutId" text,
	"checkoutProduct" text,
	"checkoutUrl" text,
	"monthlyOverageLimitMicroCents" bigint,
	"overageEnabled" boolean DEFAULT false NOT NULL,
	"selectedSubscriptionId" text,
	"updatedAt" timestamp NOT NULL,
	"userId" text PRIMARY KEY,
	CONSTRAINT "billing_account_settings_limit_check" CHECK ("monthlyOverageLimitMicroCents" is null or "monthlyOverageLimitMicroCents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "aiCreditReservation" ADD COLUMN "billingUserId" text;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "externalCustomerId" text;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD COLUMN "billingUserId" text;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ALTER COLUMN "organizationId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "billingSubscription" ALTER COLUMN "organizationId" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_credit_reservation_billing_user_idx" ON "aiCreditReservation" ("billingUserId","status");--> statement-breakpoint
CREATE INDEX "organization_mail_send_billing_user_idx" ON "organizationMailSendIdempotency" ("billingUserId","status");--> statement-breakpoint
ALTER TABLE "aiCreditReservation" ADD CONSTRAINT "aiCreditReservation_billingUserId_user_id_fkey" FOREIGN KEY ("billingUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingAccountSettings" ADD CONSTRAINT "billingAccountSettings_lJh3DNIk6Soo_fkey" FOREIGN KEY ("selectedSubscriptionId") REFERENCES "billingSubscription"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billingAccountSettings" ADD CONSTRAINT "billingAccountSettings_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD CONSTRAINT "organizationMailSendIdempotency_billingUserId_user_id_fkey" FOREIGN KEY ("billingUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" DROP CONSTRAINT "billingCreditUsageEvent_organizationId_organization_id_fkey", ADD CONSTRAINT "billingCreditUsageEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billingSubscription" DROP CONSTRAINT "billingSubscription_organizationId_organization_id_fkey", ADD CONSTRAINT "billingSubscription_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" DROP CONSTRAINT "billing_credit_usage_event_target_check", ADD CONSTRAINT "billing_credit_usage_event_target_check" CHECK (("scope" = 'team' and "organizationId" is not null) or ("scope" in ('team', 'account') and "userId" is not null));