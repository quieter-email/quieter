-- quieter:contract
ALTER FUNCTION public.gmail_capture_search_full(jsonb)
  SET search_path TO pg_catalog, public, pg_temp;
--> statement-breakpoint
ALTER FUNCTION public.gmail_capture_search_document(jsonb)
  SET search_path TO pg_catalog, public, pg_temp;
