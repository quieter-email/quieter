-- quieter:contract
CREATE FUNCTION dispatch_gmail_semantic_index_work() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ready_at timestamp := greatest(NEW."availableAt", NEW."leaseExpiresAt");
BEGIN
  IF (NEW."completedAt" IS NULL OR NEW."requestedAt" > NEW."completedAt")
    AND (TG_OP = 'INSERT' OR OLD."completedAt" >= OLD."requestedAt"
      OR ready_at < greatest(OLD."availableAt", OLD."leaseExpiresAt"))
    AND EXISTS (
      SELECT 1 FROM public.mailbox m WHERE m.id = NEW."mailboxId" AND m.provider = 'gmail'
        AND m.status = 'connected' AND m."ownerUserId" = NEW."userId"
    ) THEN
    PERFORM public.enqueue_mail_dispatch_event(jsonb_build_object(
      'kind', 'gmail', 'mailboxId', NEW."mailboxId", 'tasks', jsonb_build_array('memory'),
      'dueAt', ceil(extract(epoch FROM ready_at) * 1000)::bigint
    ));
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER dispatch_gmail_semantic_index
AFTER INSERT OR UPDATE OF "requestedAt" ON "semanticIndexRequest"
FOR EACH ROW EXECUTE FUNCTION dispatch_gmail_semantic_index_work();
--> statement-breakpoint
CREATE FUNCTION refresh_gmail_semantic_index() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_mailbox text;
  target_user text;
  source_kind text;
  registration record;
  changed_at timestamp;
  idle boolean;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'gmailCapturedMessage' THEN
      target_mailbox := NEW."mailboxId";
      source_kind := 'mail';
    WHEN 'chatMessage' THEN
      SELECT c."mailboxId" INTO target_mailbox
      FROM public.chat c WHERE c.id = NEW."chatId" AND c."userId" = NEW."userId";
      IF NOT FOUND THEN
        RETURN NEW;
      END IF;
      target_user := NEW."userId";
      source_kind := 'chat';
    WHEN 'aiMemory' THEN
      target_mailbox := NEW.metadata->>'sourceMailboxId';
      target_user := NEW."userId";
      source_kind := 'memory';
  END CASE;

  -- Lock pending registrations too, so a worker cannot claim before this source is visible.
  FOR registration IN
    SELECT r.* FROM public."semanticIndexRequest" r
    JOIN public.mailbox m ON m.id = r."mailboxId" AND m."ownerUserId" = r."userId"
    WHERE r.kind = source_kind AND m.provider = 'gmail' AND m.status = 'connected'
      AND (target_mailbox IS NULL OR r."mailboxId" = target_mailbox)
      AND (target_user IS NULL OR r."userId" = target_user)
    ORDER BY r."userId", r."mailboxId"
    FOR NO KEY UPDATE OF r
  LOOP
    idle := registration."completedAt" >= registration."requestedAt";
    IF idle OR registration."leaseToken" IS NOT NULL THEN
      changed_at := timezone('UTC', clock_timestamp());
      UPDATE public."semanticIndexRequest" r
      SET "requestedAt" = date_trunc('milliseconds', greatest(changed_at,
            r."requestedAt" + interval '1 millisecond', r."completedAt" + interval '1 millisecond')),
          "availableAt" = CASE WHEN idle AND r."lastError" IS NULL AND r."leaseToken" IS NULL
            THEN changed_at + interval '30 seconds' ELSE r."availableAt" END
      WHERE r."userId" = registration."userId" AND r."mailboxId" = registration."mailboxId"
        AND r.kind = source_kind;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_insert AFTER INSERT ON "gmailCapturedMessage"
FOR EACH ROW WHEN (NEW."deletedAt" IS NULL AND NEW.snapshot IS NOT NULL
  AND NOT (coalesce(NEW.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH']))
EXECUTE FUNCTION refresh_gmail_semantic_index();
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_update
AFTER UPDATE OF "mailboxId", "messageId", "deletedAt", snapshot, analysis, "bodySearchText", "bodyObject" ON "gmailCapturedMessage"
FOR EACH ROW WHEN (NEW."deletedAt" IS NULL AND NEW.snapshot IS NOT NULL
  AND NOT (coalesce(NEW.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])
  AND (
    (OLD."mailboxId", OLD."messageId", OLD."deletedAt", OLD.analysis->>'version', OLD.analysis->'subject')
      IS DISTINCT FROM (NEW."mailboxId", NEW."messageId", NEW."deletedAt", NEW.analysis->>'version', NEW.analysis->'subject')
    OR coalesce(OLD.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH']
    OR coalesce(OLD."bodySearchText", OLD.snapshot->>'bodyText')
      IS DISTINCT FROM coalesce(NEW."bodySearchText", NEW.snapshot->>'bodyText')
    OR jsonb_path_query_first(OLD.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
      IS DISTINCT FROM jsonb_path_query_first(NEW.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
    OR (CASE WHEN coalesce(OLD."bodySearchText", OLD.snapshot->>'bodyText', '') = '' THEN
      (gmail_capture_html_digest(OLD.snapshot, OLD."bodyObject"), OLD.analysis->'htmlText') END)
      IS DISTINCT FROM (CASE WHEN coalesce(NEW."bodySearchText", NEW.snapshot->>'bodyText', '') = '' THEN
      (gmail_capture_html_digest(NEW.snapshot, NEW."bodyObject"), NEW.analysis->'htmlText') END)
  ))
EXECUTE FUNCTION refresh_gmail_semantic_index();
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_insert AFTER INSERT ON "chatMessage"
FOR EACH ROW WHEN (NEW.role IN ('user', 'assistant') AND NEW.parts @> '[{"type":"text"}]')
EXECUTE FUNCTION refresh_gmail_semantic_index();
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_update AFTER UPDATE OF parts, role, "chatId", "userId" ON "chatMessage"
FOR EACH ROW WHEN (NEW.role IN ('user', 'assistant') AND NEW.parts @> '[{"type":"text"}]'
  AND (OLD.parts, OLD.role, OLD."chatId", OLD."userId") IS DISTINCT FROM (NEW.parts, NEW.role, NEW."chatId", NEW."userId"))
EXECUTE FUNCTION refresh_gmail_semantic_index();
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_insert AFTER INSERT ON "aiMemory"
FOR EACH ROW WHEN (NEW.scope = 'user' AND NEW.status = 'active' AND NEW."scopeKey" = 'user:' || NEW."userId"
  AND (NEW."expiresAt" IS NULL OR NEW."expiresAt" > timezone('UTC', statement_timestamp())))
EXECUTE FUNCTION refresh_gmail_semantic_index();
--> statement-breakpoint
CREATE TRIGGER refresh_gmail_semantic_index_update
AFTER UPDATE OF scope, "scopeKey", status, "userId", "expiresAt", metadata, content, version ON "aiMemory"
FOR EACH ROW WHEN (NEW.scope = 'user' AND NEW.status = 'active' AND NEW."scopeKey" = 'user:' || NEW."userId"
  AND (NEW."expiresAt" IS NULL OR NEW."expiresAt" > timezone('UTC', statement_timestamp()))
  AND (OLD.scope, OLD."scopeKey", OLD.status, OLD."userId", OLD."expiresAt", OLD.metadata, OLD.content, OLD.version)
    IS DISTINCT FROM (NEW.scope, NEW."scopeKey", NEW.status, NEW."userId", NEW."expiresAt", NEW.metadata, NEW.content, NEW.version))
EXECUTE FUNCTION refresh_gmail_semantic_index();
