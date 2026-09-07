CREATE TABLE "billingCreditReservation" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"amountMicroCents" bigint NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "billing_credit_reservation_amount_check" CHECK ("amountMicroCents" > 0)
);
--> statement-breakpoint
CREATE INDEX "billing_credit_reservation_organization_expiry_idx" ON "billingCreditReservation" ("organizationId","expiresAt");--> statement-breakpoint
ALTER TABLE "billingCreditReservation" ADD CONSTRAINT "billingCreditReservation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;