-- quieter:contract
CREATE TABLE "mailPlacementOperation" (
	"actorUserId" text NOT NULL,
	"code" text,
	"createdAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"message" text,
	"messageIds" jsonb NOT NULL,
	"placement" text NOT NULL,
	"requestHash" text NOT NULL,
	"requestId" text NOT NULL,
	"requestedMessageIds" jsonb NOT NULL,
	"sequence" bigserial UNIQUE,
	"status" text NOT NULL,
	"threadId" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_placement_operation_request_unique" UNIQUE("actorUserId","mailboxId","requestId","threadId"),
	CONSTRAINT "mail_placement_operation_placement_check" CHECK ("placement" in ('done', 'inbox')),
	CONSTRAINT "mail_placement_operation_status_check" CHECK ("status" in ('pending', 'submitting', 'applied', 'failed', 'uncertain', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX "mail_placement_operation_thread_sequence_idx" ON "mailPlacementOperation" ("mailboxId","threadId","sequence");--> statement-breakpoint
ALTER TABLE "mailPlacementOperation" ADD CONSTRAINT "mailPlacementOperation_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailPlacementOperation" ADD CONSTRAINT "mailPlacementOperation_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessage" DROP CONSTRAINT "managed_mail_message_mailbox_state_check", ADD CONSTRAINT "managed_mail_message_mailbox_state_check" CHECK ("mailboxState" in ('active', 'done', 'draft', 'spam', 'trash'));