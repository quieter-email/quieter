-- quieter:contract
ALTER TABLE "billingSubscription" ADD COLUMN "periodCreditAmountCents" integer;--> statement-breakpoint
UPDATE "billingSubscription" SET "periodCreditAmountCents" = CASE "plan" WHEN 'pro' THEN 2000 WHEN 'managed' THEN 1000 ELSE 0 END WHERE "scope" = 'account' AND "periodCreditAmountCents" IS NULL;--> statement-breakpoint
ALTER TABLE "billingSubscription" ADD CONSTRAINT "billing_subscription_account_credit_check" CHECK ("scope" <> 'account' or ("periodCreditAmountCents" is not null and "periodCreditAmountCents" >= 0));
