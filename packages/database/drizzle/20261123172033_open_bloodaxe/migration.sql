-- quieter:no-transaction
CREATE INDEX CONCURRENTLY "semantic_index_request_ready_mailbox_idx" ON "semanticIndexRequest" (greatest("availableAt", "leaseExpiresAt"),"mailboxId");