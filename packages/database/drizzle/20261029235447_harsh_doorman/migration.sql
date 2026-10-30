CREATE TABLE "aiCreditReservation" (
	"account" jsonb,
	"actualCostMicroCents" bigint,
	"createdAt" timestamp NOT NULL,
	"groupId" text NOT NULL,
	"providerGenerationId" text,
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"reservedCostMicroCents" bigint NOT NULL,
	"status" text NOT NULL,
	"usageKind" text NOT NULL,
	CONSTRAINT "ai_credit_reservation_cost_check" CHECK ("reservedCostMicroCents" >= 0)
);
--> statement-breakpoint
CREATE INDEX "ai_credit_reservation_group_idx" ON "aiCreditReservation" ("groupId");--> statement-breakpoint
CREATE INDEX "ai_credit_reservation_organization_idx" ON "aiCreditReservation" ("organizationId","status");--> statement-breakpoint
ALTER TABLE "aiCreditReservation" ADD CONSTRAINT "aiCreditReservation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;