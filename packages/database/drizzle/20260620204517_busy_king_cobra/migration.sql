CREATE TABLE "billingCreditUsageEvent" (
	"id" text PRIMARY KEY,
	"userId" text,
	"organizationId" text,
	"scope" text NOT NULL,
	"category" text NOT NULL,
	"costMicroCents" bigint NOT NULL,
	"billableCostMicroCents" bigint NOT NULL,
	"dedupeKey" text NOT NULL CONSTRAINT "billing_credit_usage_event_dedupe_key_unique" UNIQUE,
	"polarEventReportedAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "billing_credit_usage_event_target_check" CHECK ((
        ("scope" = 'personal' and "userId" is not null and "organizationId" is null)
        or
        ("scope" = 'team' and "userId" is null and "organizationId" is not null)
      )),
	CONSTRAINT "billing_credit_usage_event_cost_check" CHECK ("costMicroCents" >= 0),
	CONSTRAINT "billing_credit_usage_event_billable_cost_check" CHECK ("billableCostMicroCents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "billingSubscription" ADD COLUMN "organizationId" text;--> statement-breakpoint
ALTER TABLE "billingSubscription" ADD COLUMN "scope" text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_credit_usage_event_personal_period_idx" ON "billingCreditUsageEvent" ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "billing_credit_usage_event_team_period_idx" ON "billingCreditUsageEvent" ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "billing_subscription_organization_id_idx" ON "billingSubscription" ("organizationId");--> statement-breakpoint
CREATE INDEX "billing_subscription_scope_target_idx" ON "billingSubscription" ("scope","userId","organizationId");--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD CONSTRAINT "billingCreditUsageEvent_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD CONSTRAINT "billingCreditUsageEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billingSubscription" ADD CONSTRAINT "billingSubscription_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;