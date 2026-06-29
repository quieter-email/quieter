CREATE TABLE "organizationMailSendIdempotency" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"idempotencyKey" text NOT NULL,
	"requestHash" text NOT NULL,
	"response" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_mail_send_idempotency_organization_key_unique" UNIQUE("organizationId","idempotencyKey")
);
--> statement-breakpoint
CREATE INDEX "organization_mail_send_idempotency_organization_created_idx" ON "organizationMailSendIdempotency" ("organizationId","createdAt");--> statement-breakpoint
ALTER TABLE "organizationMailSendIdempotency" ADD CONSTRAINT "organizationMailSendIdempotency_BnWifFjgj6Vc_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;