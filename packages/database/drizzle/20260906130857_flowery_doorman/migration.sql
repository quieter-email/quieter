CREATE TABLE "mailPayloadUpload" (
	"cleanupGeneration" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"nextActionAt" timestamp with time zone NOT NULL,
	"objects" jsonb NOT NULL,
	"organizationId" text NOT NULL,
	"status" text DEFAULT 'uploading' NOT NULL,
	CONSTRAINT "mail_payload_upload_owner_unique" UNIQUE("id","organizationId"),
	CONSTRAINT "mail_payload_upload_status_check" CHECK ("status" IN ('uploading', 'ready', 'committed', 'deleting')),
	CONSTRAINT "mail_payload_upload_bounds_check" CHECK ("expiresAt" > "createdAt" AND "cleanupGeneration" >= 0 AND jsonb_array_length("objects") BETWEEN 1 AND 50 AND octet_length("objects"::text) <= 65536)
);
--> statement-breakpoint
ALTER TABLE "mailSubmission" ADD COLUMN "payloadUploadId" text;--> statement-breakpoint
CREATE INDEX "mail_payload_upload_recovery_idx" ON "mailPayloadUpload" ("nextActionAt","id") WHERE "status" <> 'committed';--> statement-breakpoint
CREATE UNIQUE INDEX "mail_submission_payload_upload_unique" ON "mailSubmission" ("payloadUploadId") WHERE "payloadUploadId" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "mailPayloadUpload" ADD CONSTRAINT "mailPayloadUpload_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "mailSubmission" ADD CONSTRAINT "mail_submission_payload_owner_fk" FOREIGN KEY ("payloadUploadId","organizationId") REFERENCES "mailPayloadUpload"("id","organizationId") ON DELETE RESTRICT;