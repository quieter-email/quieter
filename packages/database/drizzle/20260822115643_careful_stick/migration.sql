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
ALTER TABLE "organizationMailRecipientSuppression" ALTER COLUMN "sourceProviderMessageId" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_mail_suppression_audit_recipient_idx" ON "organizationMailSuppressionAudit" ("organizationId","recipient","createdAt");--> statement-breakpoint
CREATE INDEX "organization_mail_suppression_audit_created_idx" ON "organizationMailSuppressionAudit" ("organizationId","createdAt");--> statement-breakpoint
ALTER TABLE "organizationMailSuppressionAudit" ADD CONSTRAINT "organizationMailSuppressionAudit_CDsShtIgT5hP_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryEvent" DROP CONSTRAINT "organization_mail_delivery_event_type_check", ADD CONSTRAINT "organization_mail_delivery_event_type_check" CHECK ("eventType" in ('bounced', 'complained', 'delayed', 'delivered', 'opened', 'queued', 'rejected', 'sent', 'unsubscribed'));--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryRecipient" DROP CONSTRAINT "organization_mail_delivery_recipient_status_check", ADD CONSTRAINT "organization_mail_delivery_recipient_status_check" CHECK ("status" in ('bounced', 'complained', 'delayed', 'delivered', 'opened', 'queued', 'rejected', 'sent', 'unsubscribed'));--> statement-breakpoint
ALTER TABLE "organizationMailRecipientSuppression" DROP CONSTRAINT "organization_mail_recipient_suppression_reason_check", ADD CONSTRAINT "organization_mail_recipient_suppression_reason_check" CHECK ("reason" in ('bounce', 'complaint', 'manual', 'unsubscribe'));