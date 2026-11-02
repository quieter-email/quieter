CREATE TABLE "organizationEmailTemplate" (
	"archivedAt" timestamp,
	"content" jsonb NOT NULL,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"organizationId" text NOT NULL,
	"subject" text NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizationTemplateOperation" (
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"idempotencyKey" text NOT NULL,
	"inputHash" text NOT NULL,
	"operation" text NOT NULL,
	"organizationId" text NOT NULL,
	"result" jsonb,
	CONSTRAINT "organization_template_operation_key_unique" UNIQUE("organizationId","idempotencyKey"),
	CONSTRAINT "organization_template_operation_type_check" CHECK ("operation" in ('create', 'duplicate'))
);
--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "organizationCampaign" ADD COLUMN "html" text;--> statement-breakpoint
CREATE INDEX "organization_email_template_list_idx" ON "organizationEmailTemplate" ("organizationId","archivedAt","updatedAt");--> statement-breakpoint
ALTER TABLE "organizationEmailTemplate" ADD CONSTRAINT "organizationEmailTemplate_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationTemplateOperation" ADD CONSTRAINT "organizationTemplateOperation_ecvhUQRCKTj3_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;