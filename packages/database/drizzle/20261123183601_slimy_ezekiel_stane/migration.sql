-- quieter:contract
CREATE TABLE "mailDispatchEvent" (
	"createdAt" timestamp DEFAULT timezone('UTC', now()) NOT NULL,
	"id" text PRIMARY KEY DEFAULT gen_random_uuid(),
	"payload" jsonb NOT NULL,
	"shard" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailDispatchSettings" (
	"enabled" boolean DEFAULT false NOT NULL,
	"key" text PRIMARY KEY
);
--> statement-breakpoint
CREATE INDEX "mail_dispatch_event_shard_created_idx" ON "mailDispatchEvent" ("shard","createdAt","id");
--> statement-breakpoint
CREATE FUNCTION enqueue_mail_dispatch_event(event jsonb) RETURNS boolean
LANGUAGE plpgsql AS $$
DECLARE
  scope text := coalesce(event->>'mailboxId', event->'update'->>'mailboxId', (event->>'task') || ':' || (event->>'scopeKey'), event->>'kind');
BEGIN
  IF EXISTS (SELECT 1 FROM public."mailDispatchSettings" WHERE key = 'mail-dispatch-v1' AND enabled) THEN
    INSERT INTO public."mailDispatchEvent" (payload, shard)
    VALUES (event, (hashtextextended(scope, 0) & 3)::int);
    RETURN true;
  END IF;
  RETURN false;
END;
$$;
--> statement-breakpoint
CREATE PUBLICATION quieter_mail_dispatch FOR TABLE "mailDispatchEvent" WITH (publish = 'insert');
--> statement-breakpoint
CREATE PUBLICATION quieter_mail_dispatch_0 FOR TABLE "mailDispatchEvent" WHERE (shard = 0) WITH (publish = 'insert');
--> statement-breakpoint
CREATE PUBLICATION quieter_mail_dispatch_1 FOR TABLE "mailDispatchEvent" WHERE (shard = 1) WITH (publish = 'insert');
--> statement-breakpoint
CREATE PUBLICATION quieter_mail_dispatch_2 FOR TABLE "mailDispatchEvent" WHERE (shard = 2) WITH (publish = 'insert');
--> statement-breakpoint
CREATE PUBLICATION quieter_mail_dispatch_3 FOR TABLE "mailDispatchEvent" WHERE (shard = 3) WITH (publish = 'insert');
--> statement-breakpoint
CREATE FUNCTION initialize_mail_dispatch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.key = 'mail-dispatch-v1' AND NEW.enabled
     AND (TG_OP = 'INSERT' OR NOT OLD.enabled) THEN
    DELETE FROM public."gmailSchedulerEnrollment" WHERE key = 'gmail-mail-dispatch-v1';
    PERFORM public.enqueue_mail_dispatch_event('{"kind":"gmail-enrollment"}'::jsonb);
    PERFORM public.enqueue_mail_dispatch_event('{"kind":"maintenance-enrollment"}'::jsonb);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER initialize_mail_dispatch AFTER INSERT OR UPDATE OF enabled
ON "mailDispatchSettings" FOR EACH ROW EXECUTE FUNCTION initialize_mail_dispatch();
--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_disconnect() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.enqueue_mail_dispatch_event(
    jsonb_build_object('kind','gmail','mailboxId',OLD.id,'tasks',jsonb_build_array('sync'))
  );
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_disconnect AFTER DELETE ON mailbox
FOR EACH ROW WHEN (OLD.provider = 'gmail') EXECUTE FUNCTION dispatch_gmail_disconnect();
--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_connection() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."schedulerRepairAt" <= timezone('UTC', clock_timestamp()) THEN
    PERFORM public.enqueue_mail_dispatch_event(
      jsonb_build_object('kind','gmail','mailboxId',NEW."mailboxId",'tasks',jsonb_build_array('sync','memory'))
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_connection AFTER INSERT OR UPDATE OF "schedulerRepairAt"
ON "gmailWatchState" FOR EACH ROW WHEN (NEW."schedulerRepairAt" IS NOT NULL)
EXECUTE FUNCTION dispatch_gmail_connection();
--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_automation_work() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  mailbox_id text := to_jsonb(NEW)->>'mailboxId';
BEGIN
  IF TG_TABLE_NAME = 'mailReminderJob' THEN
    SELECT "mailboxId" INTO mailbox_id FROM public."mailReminder" WHERE id = NEW."reminderId";
  END IF;
  IF EXISTS (SELECT 1 FROM public.mailbox WHERE id = mailbox_id AND provider = 'gmail' AND status = 'connected') THEN
    PERFORM public.enqueue_mail_dispatch_event(
      jsonb_build_object('kind','gmail','mailboxId',mailbox_id,'tasks',jsonb_build_array(TG_ARGV[0]))
    );
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_action_work AFTER INSERT ON "mailboxAgentRun"
FOR EACH ROW WHEN (NEW.status = 'queued') EXECUTE FUNCTION dispatch_gmail_automation_work('actions');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_importance_work AFTER INSERT OR UPDATE OF "contentHash" ON "mailMessageImportance"
FOR EACH ROW WHEN (NEW.state = 'pending') EXECUTE FUNCTION dispatch_gmail_automation_work('importance');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_memory_event AFTER INSERT ON "userAiContextEvent"
FOR EACH ROW WHEN (NEW."mailboxId" IS NOT NULL) EXECUTE FUNCTION dispatch_gmail_automation_work('memory');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_memory_bootstrap AFTER INSERT OR UPDATE OF status ON "aiMemoryMailboxState"
FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION dispatch_gmail_automation_work('memory');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_semantic_index AFTER INSERT OR UPDATE OF "requestedAt" ON "semanticIndexRequest"
FOR EACH ROW EXECUTE FUNCTION dispatch_gmail_automation_work('memory');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_reminder_job AFTER INSERT ON "mailReminderJob"
FOR EACH ROW WHEN (NEW.kind = 'evaluate') EXECUTE FUNCTION dispatch_gmail_automation_work('reminders');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_reminder_suggestion AFTER INSERT ON "mailReminderSuggestion"
FOR EACH ROW WHEN (NEW.status = 'pending') EXECUTE FUNCTION dispatch_gmail_automation_work('reminders');
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_reminder_intent AFTER INSERT OR UPDATE OF status ON "gmailComposeOperation"
FOR EACH ROW WHEN (NEW.kind = 'send' AND NEW.status = 'accepted' AND NEW."followUpReminder" IS NOT NULL)
EXECUTE FUNCTION dispatch_gmail_automation_work('reminders');

--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_new_message_work() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.enqueue_mail_dispatch_event(jsonb_build_object(
    'kind', 'gmail', 'mailboxId', "mailboxId",
    'tasks', jsonb_build_array(CASE WHEN is_fresh THEN 'fresh' ELSE 'catchup' END)
  ))
  FROM (
    SELECT DISTINCT "mailboxId", (source = 'fresh' OR "liveArrival" IS TRUE) AS is_fresh
    FROM new_gmail_work
  ) candidate;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_new_message_work AFTER INSERT ON "gmailMessageWork"
REFERENCING NEW TABLE AS new_gmail_work FOR EACH STATEMENT
EXECUTE FUNCTION dispatch_gmail_new_message_work();
--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_promoted_message_work() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.enqueue_mail_dispatch_event(jsonb_build_object(
    'kind', 'gmail', 'mailboxId', "mailboxId",
    'tasks', jsonb_build_array(CASE WHEN is_fresh THEN 'fresh' ELSE 'catchup' END)
  ))
  FROM (
    SELECT DISTINCT next."mailboxId", (next.source = 'fresh' OR next."liveArrival" IS TRUE) AS is_fresh
    FROM next_work next JOIN previous_work previous ON previous.id = next.id
    WHERE (previous."liveArrival" IS NOT TRUE AND next."liveArrival" IS TRUE)
      OR (previous.source <> next.source)
      OR (previous."completedAt" IS NOT NULL AND next."completedAt" IS NULL)
      OR (NOT previous."triggerActions" AND next."triggerActions")
  ) candidate;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_promoted_message_work AFTER UPDATE ON "gmailMessageWork"
REFERENCING OLD TABLE AS previous_work NEW TABLE AS next_work FOR EACH STATEMENT
EXECUTE FUNCTION dispatch_gmail_promoted_message_work();
--> statement-breakpoint
CREATE FUNCTION dispatch_gmail_memory_on_learning_enabled() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD."activeLearningEnabled" IS NOT TRUE THEN
    PERFORM public.enqueue_mail_dispatch_event(jsonb_build_object(
      'kind','gmail','mailboxId',id,'tasks',jsonb_build_array('memory')
    ))
    FROM public.mailbox
    WHERE provider = 'gmail' AND status = 'connected'
      AND "ownerUserId" = substring(NEW."scopeKey" FROM 6);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER dispatch_gmail_memory_on_learning_enabled AFTER INSERT OR UPDATE OF "activeLearningEnabled"
ON "aiMemoryScopeConfig" FOR EACH ROW
WHEN (NEW."activeLearningEnabled" AND NEW."scopeKey" LIKE 'user:%')
EXECUTE FUNCTION dispatch_gmail_memory_on_learning_enabled();
