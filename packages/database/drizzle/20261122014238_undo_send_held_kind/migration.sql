-- quieter:contract
ALTER TABLE "scheduledMailSend" ADD COLUMN "deliveryKind" text DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "scheduledMailSend" ADD CONSTRAINT "scheduled_mail_send_delivery_kind_check" CHECK ("deliveryKind" in ('scheduled', 'undo')) NOT VALID;