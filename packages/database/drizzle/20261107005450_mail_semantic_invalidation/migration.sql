-- quieter:contract
DROP TRIGGER gmail_message_semantic_invalidation ON "gmailCapturedMessage";
--> statement-breakpoint
CREATE TRIGGER gmail_message_semantic_invalidation BEFORE UPDATE ON "gmailCapturedMessage"
FOR EACH ROW WHEN (
  OLD."mailboxId" IS DISTINCT FROM NEW."mailboxId"
  OR OLD."messageId" IS DISTINCT FROM NEW."messageId"
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  OR OLD.snapshot->'bodyText' IS DISTINCT FROM NEW.snapshot->'bodyText'
  OR jsonb_path_query_first(OLD.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
    IS DISTINCT FROM jsonb_path_query_first(NEW.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
  OR OLD.analysis->'subject' IS DISTINCT FROM NEW.analysis->'subject'
  OR (CASE WHEN coalesce(OLD.snapshot->>'bodyText', '') = '' THEN OLD.snapshot->'bodyHtml' END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW.snapshot->>'bodyText', '') = '' THEN NEW.snapshot->'bodyHtml' END)
  OR (CASE WHEN coalesce(OLD.snapshot->>'bodyText', '') = '' THEN OLD.analysis->'htmlText' END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW.snapshot->>'bodyText', '') = '' THEN NEW.analysis->'htmlText' END)
  OR (coalesce(OLD.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])
    IS DISTINCT FROM (coalesce(NEW.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])
)
EXECUTE FUNCTION purge_semantic_source_embeddings();
--> statement-breakpoint
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
  OR (OLD."mailboxState" IN ('active', 'archived'))
    IS DISTINCT FROM (NEW."mailboxState" IN ('active', 'archived'))
)
EXECUTE FUNCTION purge_semantic_source_embeddings();
