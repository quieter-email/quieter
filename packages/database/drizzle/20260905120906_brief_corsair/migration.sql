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
CREATE TABLE "organizationMailSuppressionAudit" (
	"action" text NOT NULL,
	"actorUserId" text,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"reason" text NOT NULL,
	"recipient" text NOT NULL,
	"sourceProviderMessageId" text,
	CONSTRAINT "organization_mail_suppression_audit_action_check" CHECK ("action" in ('suppressed', 'unsuppressed'))
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
ALTER TABLE "organizationMailRecipientSuppression" ALTER COLUMN "sourceProviderMessageId" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "managed_mail_message_outbound_header_idx" ON "managedMailMessage" ("messageHeaderId") WHERE "direction" = 'outbound';--> statement-breakpoint
CREATE INDEX "managed_mail_message_outbound_provider_idx" ON "managedMailMessage" ("providerMessageId") WHERE "direction" = 'outbound';--> statement-breakpoint
CREATE INDEX "organization_api_mail_message_header_idx" ON "organizationApiMailMessage" ("messageHeaderId");--> statement-breakpoint
CREATE INDEX "organization_api_mail_message_provider_idx" ON "organizationApiMailMessage" ("providerMessageId");--> statement-breakpoint
CREATE INDEX "organization_mail_open_event_organization_time_idx" ON "organizationMailOpenEvent" ("organizationId","firstOpenedAt");--> statement-breakpoint
CREATE INDEX "organization_mail_suppression_audit_recipient_idx" ON "organizationMailSuppressionAudit" ("organizationId","recipient","createdAt");--> statement-breakpoint
CREATE INDEX "organization_mail_suppression_audit_created_idx" ON "organizationMailSuppressionAudit" ("organizationId","createdAt");--> statement-breakpoint
ALTER TABLE "organizationMailOpenEvent" ADD CONSTRAINT "organizationMailOpenEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailSuppressionAudit" ADD CONSTRAINT "organizationMailSuppressionAudit_CDsShtIgT5hP_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailTrackingSettings" ADD CONSTRAINT "organizationMailTrackingSettings_UJMgSNP7bdp5_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryEvent" DROP CONSTRAINT "organization_mail_delivery_event_type_check", ADD CONSTRAINT "organization_mail_delivery_event_type_check" CHECK ("eventType" in ('bounced', 'complained', 'delayed', 'delivered', 'opened', 'queued', 'rejected', 'sent', 'unsubscribed'));--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryRecipient" DROP CONSTRAINT "organization_mail_delivery_recipient_status_check", ADD CONSTRAINT "organization_mail_delivery_recipient_status_check" CHECK ("status" in ('bounced', 'complained', 'delayed', 'delivered', 'queued', 'rejected', 'sent'));--> statement-breakpoint
ALTER TABLE "organizationMailRecipientSuppression" DROP CONSTRAINT "organization_mail_recipient_suppression_reason_check", ADD CONSTRAINT "organization_mail_recipient_suppression_reason_check" CHECK ("reason" in ('bounce', 'complaint', 'manual', 'unsubscribe'));