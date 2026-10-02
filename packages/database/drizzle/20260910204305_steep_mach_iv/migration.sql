-- quieter:contract
-- Drops the mail sync engine tables after the sync engine revert. Reviewed and
-- authorized on 2026-09-10; rollback to the sync engine is no longer possible.
ALTER TABLE "mailSyncOutbox" DROP CONSTRAINT "mailSyncOutbox_XZ1v8tq0YcLW_fkey";--> statement-breakpoint
DROP TABLE "mailSyncBody";--> statement-breakpoint
DROP TABLE "mailSyncChange";--> statement-breakpoint
DROP TABLE "mailSyncCommand";--> statement-breakpoint
DROP TABLE "mailSyncEntity";--> statement-breakpoint
DROP TABLE "mailSyncOutbox";--> statement-breakpoint
DROP TABLE "mailSyncProviderState";--> statement-breakpoint
DROP TABLE "mailSyncStream";--> statement-breakpoint
DROP TABLE "mailSyncSubmission";