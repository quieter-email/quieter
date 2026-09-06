ALTER TABLE "mailSubmission" ADD COLUMN "storageBytes" integer GENERATED ALWAYS AS (greatest(octet_length("payload"::text), "messageBytes")) STORED;--> statement-breakpoint
CREATE INDEX "mail_payload_upload_storage_owner_idx" ON "mailPayloadUpload" ("organizationId","id");--> statement-breakpoint
CREATE INDEX "mail_submission_storage_owner_idx" ON "mailSubmission" ("organizationId","id");