CREATE TABLE "organizationMailDeliveryEvent" (
	"createdAt" timestamp NOT NULL,
	"dedupeKey" text NOT NULL CONSTRAINT "organization_mail_delivery_event_dedupe_key_unique" UNIQUE,
	"diagnosticCode" text,
	"eventType" text NOT NULL,
	"id" text PRIMARY KEY,
	"occurredAt" timestamp NOT NULL,
	"organizationId" text NOT NULL,
	"provider" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"providerStatus" text,
	"reason" text,
	"recipient" text NOT NULL,
	CONSTRAINT "organization_mail_delivery_event_type_check" CHECK ("eventType" in ('bounced', 'complained', 'delayed', 'delivered', 'rejected', 'sent'))
);
--> statement-breakpoint
CREATE TABLE "organizationMailDeliveryRecipient" (
	"createdAt" timestamp NOT NULL,
	"lastEventAt" timestamp NOT NULL,
	"organizationId" text,
	"providerMessageId" text,
	"recipient" text,
	"status" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_mail_delivery_recipient_pk" PRIMARY KEY("organizationId","providerMessageId","recipient"),
	CONSTRAINT "organization_mail_delivery_recipient_status_check" CHECK ("status" in ('bounced', 'complained', 'delayed', 'delivered', 'rejected', 'sent'))
);
--> statement-breakpoint
CREATE TABLE "organizationMailRecipientSuppression" (
	"createdAt" timestamp NOT NULL,
	"organizationId" text,
	"reason" text NOT NULL,
	"recipient" text,
	"revokedAt" timestamp,
	"sourceProviderMessageId" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_mail_recipient_suppression_pk" PRIMARY KEY("organizationId","recipient"),
	CONSTRAINT "organization_mail_recipient_suppression_reason_check" CHECK ("reason" in ('bounce', 'complaint'))
);
--> statement-breakpoint
CREATE INDEX "organization_mail_delivery_event_message_idx" ON "organizationMailDeliveryEvent" ("organizationId","providerMessageId","occurredAt");--> statement-breakpoint
CREATE INDEX "organization_mail_delivery_event_recipient_idx" ON "organizationMailDeliveryEvent" ("organizationId","recipient","occurredAt");--> statement-breakpoint
CREATE INDEX "organization_mail_delivery_recipient_message_idx" ON "organizationMailDeliveryRecipient" ("organizationId","providerMessageId");--> statement-breakpoint
CREATE INDEX "organization_mail_delivery_recipient_status_idx" ON "organizationMailDeliveryRecipient" ("organizationId","status","updatedAt");--> statement-breakpoint
CREATE INDEX "organization_mail_recipient_suppression_active_idx" ON "organizationMailRecipientSuppression" ("organizationId","recipient") WHERE "revokedAt" is null;--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryEvent" ADD CONSTRAINT "organizationMailDeliveryEvent_WwDAN0DEPZPH_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailDeliveryRecipient" ADD CONSTRAINT "organizationMailDeliveryRecipient_32bNMgjhmknA_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationMailRecipientSuppression" ADD CONSTRAINT "organizationMailRecipientSuppression_9TW0BgKErC7X_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;