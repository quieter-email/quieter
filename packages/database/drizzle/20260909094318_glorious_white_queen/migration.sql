ALTER TABLE "mailSyncCommand" ADD COLUMN "sequence" bigint;--> statement-breakpoint
CREATE INDEX "mail_sync_command_order_idx" ON "mailSyncCommand" ("mailboxId","sequence");