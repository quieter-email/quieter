ALTER TABLE "mailbox" ADD COLUMN "contentRevision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX CONCURRENTLY "managed_mail_message_mailbox_state_direction_thread_sent_id_idx" ON "managedMailMessage" ("mailboxId","mailboxState","direction","threadId","sentAt","id");--> statement-breakpoint
CREATE INDEX CONCURRENTLY "managed_mail_message_mailbox_unread_thread_sent_id_idx" ON "managedMailMessage" ("mailboxId","threadId","sentAt","id") WHERE "mailboxState" = 'active' and "direction" = 'inbound' and "isRead" = false;--> statement-breakpoint
ALTER TABLE "managedMailMessage" DROP CONSTRAINT "managed_mail_message_mailbox_state_check", ADD CONSTRAINT "managed_mail_message_mailbox_state_check" CHECK ("mailboxState" in ('active', 'archived', 'draft', 'spam', 'trash'));
