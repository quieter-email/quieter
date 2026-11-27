ALTER TABLE "mailCommandReceipt" ADD COLUMN "createdAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "mail_command_receipt_created_at_idx" ON "mailCommandReceipt" ("createdAt");