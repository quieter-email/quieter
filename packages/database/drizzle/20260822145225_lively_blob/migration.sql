CREATE TABLE "organizationMailOpenEvent" (
	"createdAt" timestamp NOT NULL,
	"firstOpenedAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"lastOpenedAt" timestamp NOT NULL,
	"organizationId" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"recipient" text,
	"reportedOpenCount" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organization_mail_open_event_message_unique" UNIQUE("organizationId","providerMessageId")
);
--> statement-breakpoint
CREATE TABLE "organizationMailTrackingSettings" (
	"allowPerSendOverride" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp NOT NULL,
	"openTrackingEnabled" boolean DEFAULT false NOT NULL,
	"organizationId" text PRIMARY KEY,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "organization_mail_open_event_organization_time_idx" ON "organizationMailOpenEvent" ("organizationId","firstOpenedAt");--> statement-breakpoint
ALTER TABLE "organizationMailOpenEvent" ADD CONSTRAINT "organizationMailOpenEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailTrackingSettings" ADD CONSTRAINT "organizationMailTrackingSettings_UJMgSNP7bdp5_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;