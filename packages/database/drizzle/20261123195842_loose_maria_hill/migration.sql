-- quieter:contract
ALTER TABLE "mailDispatchEvent" ADD COLUMN "dispatchAfter" timestamp;--> statement-breakpoint
CREATE INDEX "mail_dispatch_event_shard_due_idx" ON "mailDispatchEvent" ("shard",coalesce("dispatchAfter", "createdAt"),"id");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_mail_dispatch_event(event jsonb) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  scope text := coalesce(event->>'mailboxId', event->'update'->>'mailboxId', (event->>'task') || ':' || (event->>'scopeKey'), event->>'kind');
  event_id text;
BEGIN
  IF EXISTS (SELECT 1 FROM public."mailDispatchSettings" WHERE key = 'mail-dispatch-v1' AND enabled) THEN
    INSERT INTO public."mailDispatchEvent" (payload, shard)
    VALUES (event, (hashtextextended(scope, 0) & 3)::int)
    RETURNING id INTO event_id;
    RAISE NOTICE USING MESSAGE = 'quieter_mail_dispatch', DETAIL = event_id;
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
--> statement-breakpoint
DROP PUBLICATION IF EXISTS quieter_mail_dispatch, quieter_mail_dispatch_0,
  quieter_mail_dispatch_1, quieter_mail_dispatch_2, quieter_mail_dispatch_3;
