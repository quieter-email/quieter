-- quieter:contract
DROP TRIGGER managed_message_semantic_invalidation ON "managedMailMessage";
--> statement-breakpoint
CREATE TRIGGER managed_message_semantic_invalidation BEFORE UPDATE ON "managedMailMessage"
FOR EACH ROW WHEN (
  OLD.id IS DISTINCT FROM NEW.id
  OR OLD."mailboxId" IS DISTINCT FROM NEW."mailboxId"
  OR OLD."bodyText" IS DISTINCT FROM NEW."bodyText"
  OR OLD.subject IS DISTINCT FROM NEW.subject
  OR (CASE WHEN coalesce(OLD."bodyText", '') = '' THEN OLD."bodyHtml" END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW."bodyText", '') = '' THEN NEW."bodyHtml" END)
  OR (CASE WHEN coalesce(OLD."bodyText", '') = '' THEN OLD.analysis->'htmlText' END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW."bodyText", '') = '' THEN NEW.analysis->'htmlText' END)
  OR (OLD."mailboxState" IN ('active', 'done'))
    IS DISTINCT FROM (NEW."mailboxState" IN ('active', 'done'))
)
EXECUTE FUNCTION purge_semantic_source_embeddings();
