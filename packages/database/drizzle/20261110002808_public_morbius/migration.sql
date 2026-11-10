CREATE TABLE "scheduledMailSend" (
	"createdAt" timestamp with time zone NOT NULL,
	"draftRemovedAt" timestamp with time zone,
	"errorMessage" text,
	"id" text PRIMARY KEY,
	"leaseToken" text,
	"leaseUntil" timestamp with time zone,
	"mailboxId" text NOT NULL,
	"nextWakeAt" timestamp with time zone,
	"payloadRetiredAt" timestamp with time zone,
	"rawObjectBucket" text NOT NULL,
	"rawObjectKey" text NOT NULL,
	"rawObjectProvider" text NOT NULL,
	"requestHash" text NOT NULL,
	"restoredDraftId" text,
	"sendAt" timestamp with time zone NOT NULL,
	"sendOperationId" text NOT NULL,
	"sentAt" timestamp with time zone,
	"sourceDraftId" text,
	"sourceLocalId" text NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"timeZone" text NOT NULL,
	"to" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "scheduled_mail_send_operation_unique" UNIQUE("mailboxId","userId","sendOperationId"),
	CONSTRAINT "scheduled_mail_send_status_check" CHECK ("status" in ('preparing', 'scheduled', 'sending', 'sent', 'failed', 'uncertain', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX "scheduled_mail_send_owner_idx" ON "scheduledMailSend" ("userId","mailboxId","status","sendAt");--> statement-breakpoint
CREATE INDEX "scheduled_mail_send_wake_idx" ON "scheduledMailSend" ("nextWakeAt");--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_mail_send_source_local_unique" ON "scheduledMailSend" ("mailboxId","sourceLocalId") WHERE "status" in ('preparing', 'scheduled', 'sending', 'failed', 'uncertain');--> statement-breakpoint
CREATE UNIQUE INDEX "scheduled_mail_send_source_draft_unique" ON "scheduledMailSend" ("mailboxId","sourceDraftId") WHERE "status" in ('preparing', 'scheduled', 'sending', 'failed', 'uncertain');--> statement-breakpoint
ALTER TABLE "scheduledMailSend" ADD CONSTRAINT "scheduledMailSend_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduledMailSend" ADD CONSTRAINT "scheduledMailSend_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;