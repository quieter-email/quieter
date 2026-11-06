-- quieter:contract
CREATE EXTENSION IF NOT EXISTS tin;
--> statement-breakpoint
CREATE TABLE "semanticIndexRequest" (
	"userId" text,
	"mailboxId" text,
	"kind" text,
	"requestedAt" timestamp NOT NULL,
	"availableAt" timestamp NOT NULL,
	"leaseToken" text,
	"leaseExpiresAt" timestamp,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"completedAt" timestamp,
	"lastError" text,
	"indexedSources" integer DEFAULT 0 NOT NULL,
	"totalSources" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "semanticIndexRequest_pkey" PRIMARY KEY("userId","mailboxId","kind"),
	CONSTRAINT "semantic_index_request_kind_check" CHECK ("kind" in ('memory', 'chat', 'mail')),
	CONSTRAINT "semantic_index_request_count_check" CHECK ("attemptCount" >= 0 and "indexedSources" >= 0 and "totalSources" >= 0),
	CONSTRAINT "semantic_index_request_lease_check" CHECK (("leaseToken" is null) = ("leaseExpiresAt" is null))
);
--> statement-breakpoint
ALTER TABLE "semanticEmbedding" ADD COLUMN "searchText" text NOT NULL;--> statement-breakpoint
CREATE INDEX "semantic_embedding_text_idx" ON "semanticEmbedding" USING tin ("searchText");--> statement-breakpoint
CREATE INDEX "semantic_index_request_pending_idx" ON "semanticIndexRequest" ("availableAt","leaseExpiresAt");--> statement-breakpoint
ALTER TABLE "semanticIndexRequest" ADD CONSTRAINT "semanticIndexRequest_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticIndexRequest" ADD CONSTRAINT "semanticIndexRequest_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE FUNCTION purge_semantic_source_embeddings() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'aiMemory' THEN
    DELETE FROM "semanticEmbedding" WHERE "memoryId" = OLD.id;
  ELSIF TG_TABLE_NAME = 'chatMessage' THEN
    DELETE FROM "semanticEmbedding" WHERE "chatMessageId" = OLD.id;
  ELSIF TG_TABLE_NAME = 'gmailCapturedMessage' THEN
    DELETE FROM "semanticEmbedding" WHERE "gmailMailboxId" = OLD."mailboxId" AND "gmailMessageId" = OLD."messageId";
  ELSIF TG_TABLE_NAME = 'managedMailMessage' THEN
    DELETE FROM "semanticEmbedding" WHERE "managedMessageId" = OLD.id;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER ai_memory_semantic_invalidation BEFORE UPDATE ON "aiMemory"
FOR EACH ROW WHEN (OLD.version IS DISTINCT FROM NEW.version OR OLD.content IS DISTINCT FROM NEW.content OR OLD.status IS DISTINCT FROM NEW.status OR OLD."userId" IS DISTINCT FROM NEW."userId" OR OLD.metadata IS DISTINCT FROM NEW.metadata)
EXECUTE FUNCTION purge_semantic_source_embeddings();
--> statement-breakpoint
CREATE TRIGGER chat_message_semantic_invalidation BEFORE UPDATE ON "chatMessage"
FOR EACH ROW WHEN (OLD.parts IS DISTINCT FROM NEW.parts OR OLD.role IS DISTINCT FROM NEW.role OR OLD."userId" IS DISTINCT FROM NEW."userId" OR OLD."chatId" IS DISTINCT FROM NEW."chatId")
EXECUTE FUNCTION purge_semantic_source_embeddings();
--> statement-breakpoint
CREATE TRIGGER gmail_message_semantic_invalidation BEFORE UPDATE ON "gmailCapturedMessage"
FOR EACH ROW WHEN (OLD.snapshot IS DISTINCT FROM NEW.snapshot OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt" OR OLD."mailboxId" IS DISTINCT FROM NEW."mailboxId" OR OLD."messageId" IS DISTINCT FROM NEW."messageId")
EXECUTE FUNCTION purge_semantic_source_embeddings();
--> statement-breakpoint
CREATE TRIGGER managed_message_semantic_invalidation BEFORE UPDATE ON "managedMailMessage"
FOR EACH ROW WHEN (OLD."bodyText" IS DISTINCT FROM NEW."bodyText" OR OLD."bodyHtml" IS DISTINCT FROM NEW."bodyHtml" OR OLD.subject IS DISTINCT FROM NEW.subject OR OLD."mailboxState" IS DISTINCT FROM NEW."mailboxState" OR OLD."mailboxId" IS DISTINCT FROM NEW."mailboxId")
EXECUTE FUNCTION purge_semantic_source_embeddings();
