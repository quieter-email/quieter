-- quieter:no-transaction
CREATE INDEX CONCURRENTLY "gmail_captured_message_live_thread_idx" ON "gmailCapturedMessage" ("mailboxId",("snapshot"->>'threadId')) WHERE "deletedAt" is null;
