-- quieter:no-transaction
ALTER TABLE "mailbox" ADD COLUMN IF NOT EXISTS "contentRevision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "managed_mail_message_mailbox_state_direction_thread_sent_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY "managed_mail_message_mailbox_state_direction_thread_sent_id_idx" ON "managedMailMessage" ("mailboxId","mailboxState","direction","threadId","sentAt","id");--> statement-breakpoint
DROP INDEX CONCURRENTLY IF EXISTS "managed_mail_message_mailbox_unread_thread_sent_id_idx";--> statement-breakpoint
CREATE INDEX CONCURRENTLY "managed_mail_message_mailbox_unread_thread_sent_id_idx" ON "managedMailMessage" ("mailboxId","threadId","sentAt","id") WHERE "mailboxState" = 'active' and "direction" = 'inbound' and "isRead" = false;--> statement-breakpoint
ALTER TABLE "managedMailMessage" DROP CONSTRAINT IF EXISTS "managed_mail_message_mailbox_state_check";--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD CONSTRAINT "managed_mail_message_mailbox_state_check" CHECK ("mailboxState" in ('active', 'archived', 'draft', 'spam', 'trash'));
