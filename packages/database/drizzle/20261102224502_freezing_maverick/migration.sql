-- quieter:contract
ALTER TABLE "aiCreditReservation" DROP CONSTRAINT "aiCreditReservation_billingUserId_user_id_fkey";--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" DROP CONSTRAINT "billingCreditUsageEvent_userId_user_id_fkey";--> statement-breakpoint
ALTER TABLE "billingSubscription" DROP CONSTRAINT "billingSubscription_userId_user_id_fkey";--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" DROP CONSTRAINT "organizationMailSendIdempotency_billingUserId_user_id_fkey";--> statement-breakpoint
ALTER TABLE "billingAccountSettings" ADD COLUMN "deletionRequestedAt" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "billingPeriodEnd" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "billingPeriodStart" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "chargeableCostMicroCents" bigint;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "polarEventDeferredAt" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "polarEventDeferredReason" text;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "providerSubscriptionId" text;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "sourceOrganizationId" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billingDeletionRequestedAt" timestamp;--> statement-breakpoint
UPDATE "billingCreditUsageEvent" SET "sourceOrganizationId" = "organizationId" WHERE "sourceOrganizationId" IS NULL AND "organizationId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "billing_credit_usage_event_reporting_idx" ON "billingCreditUsageEvent" ("createdAt") WHERE "polarEventReportedAt" is null and "polarEventDeferredAt" is null and "billableCostMicroCents" > 0;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD CONSTRAINT "billing_credit_usage_event_account_charge_check" CHECK ("scope" <> 'account' or (
        "chargeableCostMicroCents" is not null and
        "billableCostMicroCents" <= "chargeableCostMicroCents" and
        "chargeableCostMicroCents" <= "costMicroCents" and
        "costMicroCents" <= 9007199254740991 and
        "billingPeriodStart" is not null and
        "billingPeriodEnd" is not null and
        "billingPeriodEnd" > "billingPeriodStart" and
        "providerSubscriptionId" is not null and
        "externalCustomerId" is not null and
        "sourceOrganizationId" is not null
      ));
