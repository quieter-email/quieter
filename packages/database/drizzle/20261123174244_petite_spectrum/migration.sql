-- quieter:contract
ALTER TABLE "gmailCapturedMessage" ADD COLUMN "bodyBackfillAfter" timestamp;--> statement-breakpoint
ALTER TABLE "gmailCapturedMessage" ADD COLUMN "bodyObject" jsonb;--> statement-breakpoint
ALTER TABLE "gmailCapturedMessage" ADD COLUMN "bodySearchDocument" tsvector[];--> statement-breakpoint
ALTER TABLE "gmailCapturedMessage" ADD COLUMN "bodySearchText" text;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE FUNCTION gmail_capture_search_fields(snapshot jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT jsonb_build_array(
    snapshot->>'bodyText',
    snapshot->>'bodyHtml',
    (SELECT jsonb_agg(jsonb_build_array(h->>'value', regexp_replace(h->>'value', '[^[:alnum:]]+', ' ', 'g')) ORDER BY ordinal)
       FROM jsonb_array_elements(snapshot->'headers') WITH ORDINALITY AS headers(h, ordinal)),
    (SELECT jsonb_agg(jsonb_build_array(a->>'fileName', regexp_replace(a->>'fileName', '[^[:alnum:]]+', ' ', 'g')) ORDER BY ordinal)
       FROM jsonb_array_elements(snapshot->'attachments') WITH ORDINALITY AS attachments(a, ordinal))
  );
$$;
--> statement-breakpoint
CREATE FUNCTION gmail_capture_search_full(snapshot jsonb) RETURNS tsvector
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT AS $$
BEGIN
  RETURN jsonb_to_tsvector('simple', gmail_capture_search_fields(snapshot), '["string"]');
EXCEPTION WHEN program_limit_exceeded THEN
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION gmail_capture_search_document(snapshot jsonb) RETURNS tsvector[]
LANGUAGE plpgsql IMMUTABLE PARALLEL SAFE STRICT AS $$
DECLARE
  whole tsvector := gmail_capture_search_full(snapshot);
BEGIN
  IF whole IS NOT NULL THEN
    RETURN ARRAY[whole];
  END IF;

  -- The null first element marks a document that exceeded PostgreSQL's vector
  -- limit. Overlap positional windows so a phrase can span the window boundary.
  RETURN ARRAY[NULL::tsvector] || ARRAY(
    SELECT to_tsvector('simple',
      CASE WHEN offset_at + 32768 <= length(content)
               AND substring(content FROM offset_at + 32768 FOR 1) !~ '[[:space:],;()<>]'
        THEN regexp_replace(window_start, '[^[:space:],;()<>]+$', '')
        ELSE window_start
      END)
    FROM jsonb_path_query(gmail_capture_search_fields(snapshot), 'strict $.** ? (@.type() == "string")')
      WITH ORDINALITY AS fields(value, field_order)
    CROSS JOIN LATERAL (SELECT value #>> '{}' AS content) AS field
    CROSS JOIN LATERAL generate_series(1, length(content), 16384) AS offsets(offset_at)
    CROSS JOIN LATERAL (
      SELECT CASE WHEN offset_at > 1 AND substring(content FROM offset_at - 1 FOR 1) !~ '[[:space:],;()<>]'
        THEN regexp_replace(substring(content FROM offset_at FOR 32768), '^[^[:space:],;()<>]+', '')
        ELSE substring(content FROM offset_at FOR 32768)
      END AS window_start
    ) AS bounds
    ORDER BY field_order, offset_at
  );
END;
$$;
--> statement-breakpoint
CREATE FUNCTION gmail_capture_search_chunks_match(chunks tsvector[], search_text text, phrase boolean) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT AS $$
  SELECT CASE WHEN chunks[1] IS NOT NULL THEN false
    WHEN phrase THEN EXISTS (
      SELECT 1 FROM unnest(chunks) AS chunk(document)
      WHERE document @@ phraseto_tsquery('simple', search_text)
    )
    ELSE (
      SELECT cardinality(terms) > 0 AND terms <@ ARRAY(
        SELECT DISTINCT lexeme
        FROM unnest(chunks) AS chunk(document)
        CROSS JOIN LATERAL unnest(tsvector_to_array(document)) AS words(lexeme)
      )
      FROM (SELECT tsvector_to_array(to_tsvector('simple', search_text)) AS terms) AS query
    )
  END;
$$;
--> statement-breakpoint
CREATE FUNCTION gmail_capture_html_digest(snapshot jsonb, body_object jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE WHEN body_object IS NOT NULL THEN body_object->>'htmlDigest'
    ELSE encode(sha256(convert_to(snapshot->>'bodyHtml', 'UTF8')), 'hex') END;
$$;
--> statement-breakpoint
CREATE OR REPLACE TRIGGER gmail_message_semantic_invalidation BEFORE UPDATE ON "gmailCapturedMessage"
FOR EACH ROW WHEN (
  OLD."mailboxId" IS DISTINCT FROM NEW."mailboxId"
  OR OLD."messageId" IS DISTINCT FROM NEW."messageId"
  OR OLD."deletedAt" IS DISTINCT FROM NEW."deletedAt"
  OR coalesce(OLD."bodySearchText", OLD.snapshot->>'bodyText') IS DISTINCT FROM coalesce(NEW."bodySearchText", NEW.snapshot->>'bodyText')
  OR jsonb_path_query_first(OLD.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
    IS DISTINCT FROM jsonb_path_query_first(NEW.snapshot, '$.headers[*] ? (@.name like_regex "^subject$" flag "i").value')
  OR OLD.analysis->'subject' IS DISTINCT FROM NEW.analysis->'subject'
  OR (CASE WHEN coalesce(OLD."bodySearchText", OLD.snapshot->>'bodyText', '') = '' THEN gmail_capture_html_digest(OLD.snapshot, OLD."bodyObject") END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW."bodySearchText", NEW.snapshot->>'bodyText', '') = '' THEN gmail_capture_html_digest(NEW.snapshot, NEW."bodyObject") END)
  OR (CASE WHEN coalesce(OLD."bodySearchText", OLD.snapshot->>'bodyText', '') = '' THEN OLD.analysis->'htmlText' END)
    IS DISTINCT FROM (CASE WHEN coalesce(NEW."bodySearchText", NEW.snapshot->>'bodyText', '') = '' THEN NEW.analysis->'htmlText' END)
  OR (coalesce(OLD.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])
    IS DISTINCT FROM (coalesce(NEW.snapshot->'labelIds', '[]'::jsonb) ?| array['DRAFT', 'SPAM', 'TRASH'])
)
EXECUTE FUNCTION purge_semantic_source_embeddings();
--> statement-breakpoint
CREATE FUNCTION retire_gmail_body_object() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD."bodyObject"->>'key' = NEW."bodyObject"->>'key'
      AND OLD."bodyObject"->>'bucket' = NEW."bodyObject"->>'bucket' THEN
      RETURN NULL;
    END IF;
  END IF;

  INSERT INTO "mailObjectCleanup" ("id", "provider", "bucket", "key", "createdAt", "notBefore")
  VALUES (
    gen_random_uuid()::text, 'r2', OLD."bodyObject"->>'bucket', OLD."bodyObject"->>'key',
    timezone('UTC', now()), timezone('UTC', now()) + interval '1 hour'
  )
  ON CONFLICT ("provider", "bucket", "key") DO NOTHING;

  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER gmail_body_object_retirement AFTER UPDATE OF "bodyObject" OR DELETE ON "gmailCapturedMessage"
FOR EACH ROW WHEN (OLD."bodyObject" IS NOT NULL)
EXECUTE FUNCTION retire_gmail_body_object();
