-- quieter:contract
ALTER TABLE "user" ADD COLUMN "defaultOrganizationProvisioned" boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "defaultOrganizationProvisioned" SET DEFAULT false;
