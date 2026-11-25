-- quieter:contract
-- Install after enqueue_mail_dispatch_event. The relay setting gates outbox writes.
CREATE FUNCTION mail_maintenance_enqueue(task text, due_at double precision, scope_key text DEFAULT 'global')
RETURNS void LANGUAGE sql AS $$
  SELECT enqueue_mail_dispatch_event(jsonb_build_object(
    'kind', 'maintenance', 'task', task, 'scopeKey', scope_key,
    'dueAt', greatest(0, ceil(due_at))::bigint
  ))
$$;
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_register() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_due double precision;
  previous_due double precision;
  now_ms double precision := extract(epoch FROM statement_timestamp()) * 1000;
  task text;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'scheduledMailSend' THEN
      IF NEW."nextWakeAt" IS NOT NULL AND (
        TG_OP = 'INSERT' OR NEW."nextWakeAt" < OLD."nextWakeAt" OR OLD."nextWakeAt" IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('scheduled-send', now_ms, NEW.id);
      END IF;
    WHEN 'mailReminder' THEN
      IF NEW.status = 'active' AND NEW."firedAt" IS NULL AND (
        TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status
        OR NEW."dueAt" IS DISTINCT FROM OLD."dueAt" OR OLD."firedAt" IS NOT NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('reminder-clock', now_ms, NEW.id);
      END IF;
    WHEN 'mailReminderJob' THEN
      IF NEW."completedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD."completedAt" IS NOT NULL OR NEW."availableAt" < OLD."availableAt"
      ) THEN
        IF NEW.kind = 'evaluate' THEN
          PERFORM mail_maintenance_enqueue('reminders', extract(epoch FROM greatest(NEW."availableAt", NEW."leaseUntil")) * 1000);
        ELSIF NEW.kind = 'notify' THEN
          PERFORM mail_maintenance_enqueue('reminder-clock', extract(epoch FROM greatest(NEW."availableAt", NEW."leaseUntil")) * 1000, NEW."reminderId");
        END IF;
      END IF;
      IF NEW.usage IS NOT NULL AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD.usage IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('reminder-usage', now_ms + 30000);
      END IF;
    WHEN 'mailReminderSuggestion' THEN
      IF NEW.status = 'pending' THEN
        current_due := extract(epoch FROM greatest(NEW."availableAt", NEW."leaseUntil")) * 1000;
        IF TG_OP = 'UPDATE' AND OLD.status = 'pending' THEN
          previous_due := extract(epoch FROM greatest(OLD."availableAt", OLD."leaseUntil")) * 1000;
        END IF;
        task := 'reminders';
      END IF;
      IF NEW.usage IS NOT NULL AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD.usage IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('reminder-usage', now_ms + 30000);
      END IF;
    WHEN 'organizationMailSendIdempotency' THEN
      IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status THEN
        current_due := CASE NEW.status
          WHEN 'accepted' THEN now_ms
          WHEN 'submitting' THEN extract(epoch FROM NEW."updatedAt") * 1000 + 120000
          WHEN 'prepared' THEN extract(epoch FROM NEW."updatedAt") * 1000 + 604800000
          WHEN 'rejected' THEN extract(epoch FROM NEW."updatedAt") * 1000 + 604800000
          WHEN 'completed' THEN extract(epoch FROM NEW."updatedAt") * 1000 + 604800000
        END;
        task := 'send-recovery';
      END IF;
    WHEN 'mailObjectCleanup' THEN
      IF TG_OP = 'INSERT' OR NEW."notBefore" < OLD."notBefore" THEN
        current_due := extract(epoch FROM NEW."notBefore") * 1000;
        task := 'raw-object-cleanup';
      END IF;
    WHEN 'rateLimitBucket' THEN
      current_due := extract(epoch FROM NEW."expiresAt") * 1000;
      task := 'rate-limit-retention';
    WHEN 'aiGeneratedMailBody' THEN
      IF TG_OP = 'INSERT' OR NEW."expiresAt" < OLD."expiresAt" THEN
        current_due := extract(epoch FROM NEW."expiresAt") * 1000;
        task := 'generated-body-retention';
      END IF;
    WHEN 'gmailComposeOperation' THEN
      IF (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND NEW.status IN ('accepted', 'rejected') THEN
        -- A new successor or released lock can make an older save eligible now.
        PERFORM mail_maintenance_enqueue('compose-retention', now_ms);
      END IF;
      IF NEW.kind = 'send' AND NEW.status = 'accepted' AND NEW."followUpReminder" IS NOT NULL AND (
        TG_OP = 'INSERT' OR OLD.status <> 'accepted' OR OLD."followUpReminder" IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('reminders', extract(epoch FROM NEW."updatedAt") * 1000 + 30000);
      END IF;
    WHEN 'mailboxVerificationCode' THEN
      IF TG_OP = 'INSERT' THEN
        PERFORM mail_maintenance_enqueue('code-retention', extract(epoch FROM NEW."createdAt") * 1000 + 7200000);
      ELSIF NEW."encryptedCode" IS NULL AND (
        NEW."usageReportedAt" IS DISTINCT FROM OLD."usageReportedAt" OR NEW."encryptedCode" IS DISTINCT FROM OLD."encryptedCode"
      ) THEN
        PERFORM mail_maintenance_enqueue('code-retention', extract(epoch FROM NEW."createdAt") * 1000 + 2592000000);
      END IF;
      IF NEW."processedAt" IS NULL THEN
        current_due := extract(epoch FROM greatest(NEW."createdAt", NEW."nextAttemptAt", NEW."leaseUntil")) * 1000;
        IF TG_OP = 'UPDATE' AND OLD."processedAt" IS NULL THEN
          previous_due := extract(epoch FROM greatest(OLD."createdAt", OLD."nextAttemptAt", OLD."leaseUntil")) * 1000;
        END IF;
      ELSIF NEW."costUsd" IS NOT NULL AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD."processedAt" IS NULL OR OLD."costUsd" IS NULL
      ) THEN
        current_due := now_ms + 30000;
      END IF;
      IF current_due IS NOT NULL AND EXISTS (
        SELECT 1 FROM "mailbox" WHERE id = NEW."mailboxId" AND provider = 'managed'
      ) THEN
        task := 'managed-codes';
      END IF;
    WHEN 'managedMailRuleBackfill' THEN
      IF NEW.status IN ('pending', 'running') THEN
        current_due := coalesce(extract(epoch FROM NEW."leasedUntil") * 1000, now_ms);
        IF TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'running') THEN
          previous_due := coalesce(extract(epoch FROM OLD."leasedUntil") * 1000, now_ms);
        END IF;
        task := 'managed-rules';
      END IF;
    WHEN 'mailboxAgentRun' THEN
      IF NEW.status IN ('queued', 'running') THEN
        current_due := extract(epoch FROM coalesce(NEW."leaseExpiresAt", NEW."createdAt")) * 1000;
        IF TG_OP = 'UPDATE' AND OLD.status IN ('queued', 'running') THEN
          previous_due := extract(epoch FROM coalesce(OLD."leaseExpiresAt", OLD."createdAt")) * 1000;
        END IF;
        task := 'agent-runs';
      END IF;
      IF NEW.status IN ('succeeded', 'skipped', 'needs_attention') AND NEW.usage <> '[]'::jsonb AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR OLD.usage IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('agent-usage', now_ms + 30000);
      END IF;
    WHEN 'mailboxAgentRevision' THEN
      IF NEW.usage IS NOT NULL AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD.usage IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('agent-usage', now_ms + 30000);
      END IF;
    WHEN 'mailMessageImportance' THEN
      IF NEW.state IN ('pending', 'processing', 'paused', 'error') THEN
        current_due := extract(epoch FROM greatest(NEW."nextAttemptAt", NEW."leaseExpiresAt")) * 1000;
        IF TG_OP = 'UPDATE' AND OLD.state IN ('pending', 'processing', 'paused', 'error') THEN
          previous_due := extract(epoch FROM greatest(OLD."nextAttemptAt", OLD."leaseExpiresAt")) * 1000;
        END IF;
        task := 'importance';
      END IF;
    WHEN 'mailImportanceAttempt' THEN
      IF NEW.usage IS NOT NULL AND NEW."usageReportedAt" IS NULL AND (
        TG_OP = 'INSERT' OR OLD.usage IS NULL
      ) THEN
        PERFORM mail_maintenance_enqueue('importance-usage', now_ms + 30000);
      END IF;
    WHEN 'userAiContextEvent' THEN
      IF NEW."mergedAt" IS NULL AND NEW."skippedAt" IS NULL AND NEW.metadata->>'memoryScope' = 'user' THEN
        current_due := extract(epoch FROM greatest(NEW."updatedAt", NEW."processingAt")) * 1000 + 120000;
        IF TG_OP = 'UPDATE' AND OLD."mergedAt" IS NULL AND OLD."skippedAt" IS NULL AND OLD.metadata->>'memoryScope' = 'user' THEN
          previous_due := extract(epoch FROM greatest(OLD."updatedAt", OLD."processingAt")) * 1000 + 120000;
        END IF;
        task := 'memory-events';
      END IF;
    WHEN 'aiMemoryMailboxState' THEN
      IF NEW."userId" IS NOT NULL AND NEW.status IN ('pending', 'processing', 'failed') AND (
        TG_OP = 'INSERT' OR NEW."userId" IS DISTINCT FROM OLD."userId" OR (NEW.status = 'pending' AND OLD.status <> 'pending')
      ) THEN
        current_due := CASE NEW.status
          WHEN 'pending' THEN now_ms
          WHEN 'failed' THEN extract(epoch FROM NEW."updatedAt") * 1000 + 300000
          ELSE extract(epoch FROM NEW."processingAt") * 1000 + 300000
        END;
        task := 'memory-bootstrap';
      END IF;
    WHEN 'semanticIndexRequest' THEN
      IF NEW."completedAt" IS NULL OR NEW."requestedAt" > NEW."completedAt" THEN
        current_due := extract(epoch FROM greatest(NEW."availableAt", NEW."leaseExpiresAt")) * 1000;
        IF TG_OP = 'UPDATE' AND (OLD."completedAt" IS NULL OR OLD."requestedAt" > OLD."completedAt") THEN
          previous_due := extract(epoch FROM greatest(OLD."availableAt", OLD."leaseExpiresAt")) * 1000;
        END IF;
        task := 'semantic-index';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unexpected maintenance producer %', TG_TABLE_NAME;
  END CASE;
  IF task IS NOT NULL AND current_due IS NOT NULL AND (previous_due IS NULL OR current_due < previous_due) THEN
    IF task IN ('agent-runs', 'importance', 'memory-bootstrap', 'semantic-index')
      AND EXISTS (SELECT 1 FROM "mailDispatchSettings" WHERE key = 'gmail-mailbox-lanes-v1' AND enabled)
      AND EXISTS (SELECT 1 FROM "mailbox" WHERE id = to_jsonb(NEW)->>'mailboxId' AND provider = 'gmail') THEN
      RETURN NEW;
    END IF;
    PERFORM mail_maintenance_enqueue(task, current_due);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "nextWakeAt" ON "scheduledMailSend"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "dueAt", "firedAt" ON "mailReminder"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "completedAt", "availableAt", "usage" ON "mailReminderJob"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "availableAt", "leaseUntil", "usage" ON "mailReminderSuggestion"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status" ON "organizationMailSendIdempotency"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "notBefore" ON "mailObjectCleanup"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT ON "rateLimitBucket"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "expiresAt" ON "aiGeneratedMailBody"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "followUpReminder" ON "gmailComposeOperation"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "usageReportedAt", "encryptedCode", "processedAt", "nextAttemptAt", "leaseUntil", "costUsd" ON "mailboxVerificationCode"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "leasedUntil" ON "managedMailRuleBackfill"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "leaseExpiresAt", "usage" ON "mailboxAgentRun"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "usage" ON "mailboxAgentRevision"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "state", "nextAttemptAt", "leaseExpiresAt" ON "mailMessageImportance"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "usage" ON "mailImportanceAttempt"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "mergedAt", "skippedAt", "metadata", "processingAt", "updatedAt" ON "userAiContextEvent"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "status", "userId" ON "aiMemoryMailboxState"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_register AFTER INSERT OR UPDATE OF "requestedAt", "completedAt", "availableAt", "leaseExpiresAt" ON "semanticIndexRequest"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_register();
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_next_wake(task text, mailbox_lanes boolean)
RETURNS double precision LANGUAGE plpgsql STABLE AS $$
DECLARE
  due_at timestamp;
  pending_at timestamp;
  provider_filter text := CASE WHEN mailbox_lanes THEN 'managed' ELSE NULL END;
BEGIN
  CASE task
    WHEN 'send-recovery' THEN
      SELECT least(
        (SELECT min("updatedAt") FROM "organizationMailSendIdempotency" WHERE status = 'accepted'),
        (SELECT min("updatedAt") FROM "organizationMailSendIdempotency" WHERE status = 'submitting') + interval '2 minutes',
        (SELECT min("updatedAt") FROM "organizationMailSendIdempotency" WHERE status IN ('completed', 'rejected', 'prepared')) + interval '7 days'
      ) INTO due_at;
    WHEN 'raw-object-cleanup' THEN
      SELECT min("notBefore") INTO due_at FROM "mailObjectCleanup" WHERE "notBefore" < 'infinity'::timestamp;
    WHEN 'rate-limit-retention' THEN
      SELECT min("expiresAt") INTO due_at FROM "rateLimitBucket";
    WHEN 'generated-body-retention' THEN
      SELECT min("expiresAt") INTO due_at FROM "aiGeneratedMailBody";
    WHEN 'compose-retention' THEN
      SELECT min(r."updatedAt") + interval '30 days' INTO due_at
      FROM "gmailComposeOperation" r
      WHERE (r.status = 'rejected'
        OR (r.status = 'accepted' AND (
          r."operationKey" LIKE 'lock:%'
          OR (r.kind = 'save' AND r."operationKey" LIKE 'save:%'
            AND r."operationKey" NOT LIKE 'save:create:%'
            AND EXISTS (
              SELECT 1 FROM "gmailComposeOperation" s
              WHERE s."mailboxId" = r."mailboxId" AND s."draftId" = r."draftId"
                AND s.kind = 'save' AND s.status = 'accepted' AND s."createdAt" > r."createdAt"
            ))
        )))
        AND NOT EXISTS (
          SELECT 1 FROM "gmailComposeOperation" l
          WHERE l."mailboxId" = r."mailboxId" AND l."operationKey" LIKE 'lock:%'
            AND l.status IN ('submitting', 'unknown')
        );
    WHEN 'code-retention' THEN
      SELECT least(
        (SELECT min(greatest("createdAt" + interval '2 hours', "leaseUntil")) FROM "mailboxVerificationCode"
          WHERE "processedAt" IS NULL),
        (SELECT min("createdAt") + interval '30 days' FROM "mailboxVerificationCode"
          WHERE "encryptedCode" IS NULL AND ("costUsd" IS NULL OR "costUsd" <= 0 OR "usageReportedAt" IS NOT NULL))
      ) INTO due_at;
    WHEN 'managed-rules' THEN
      SELECT min(coalesce("leasedUntil", "updatedAt")) INTO due_at FROM "managedMailRuleBackfill"
      WHERE status IN ('pending', 'running');
    WHEN 'managed-codes' THEN
      SELECT min(CASE WHEN c."processedAt" IS NULL
        THEN greatest(c."createdAt", c."nextAttemptAt", c."leaseUntil") ELSE c."updatedAt" END)
      INTO due_at FROM "mailboxVerificationCode" c
      JOIN "mailbox" m ON m.id = c."mailboxId"
      JOIN "organization" o ON o.id = m."organizationId"
      WHERE m.provider = 'managed' AND o."billingOwnerUserId" IS NOT NULL AND (
        (c."processedAt" IS NULL
          AND greatest(c."nextAttemptAt", c."leaseUntil", timezone('UTC', now())) < c."createdAt" + interval '2 hours')
        OR (c."processedAt" IS NOT NULL AND c."costUsd" IS NOT NULL AND c."usageReportedAt" IS NULL)
      );
    WHEN 'agent-runs' THEN
      SELECT min(coalesce(r."leaseExpiresAt", r."createdAt")) INTO due_at FROM "mailboxAgentRun" r
      JOIN "mailbox" m ON m.id = r."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter)
        AND (r.status = 'queued' OR (r.status = 'running' AND r."leaseExpiresAt" IS NOT NULL));
    WHEN 'agent-usage' THEN
      SELECT least(
        (SELECT min("createdAt") FROM "mailboxAgentRun" WHERE "usageReportedAt" IS NULL AND usage <> '[]'::jsonb
          AND status IN ('succeeded', 'skipped', 'needs_attention')),
        (SELECT min("createdAt") FROM "mailboxAgentRevision" WHERE "usageReportedAt" IS NULL AND usage IS NOT NULL)
      ) INTO due_at;
    WHEN 'importance' THEN
      SELECT min(greatest(i."nextAttemptAt", i."leaseExpiresAt")) INTO due_at FROM "mailMessageImportance" i
      JOIN "mailbox" m ON m.id = i."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter)
        AND i.state IN ('pending', 'processing', 'paused', 'error');
    WHEN 'importance-usage' THEN
      SELECT min("createdAt") INTO due_at FROM "mailImportanceAttempt"
      WHERE usage IS NOT NULL AND "usageReportedAt" IS NULL;
    WHEN 'reminders' THEN
      SELECT min(greatest(j."availableAt", j."leaseUntil")) AT TIME ZONE 'UTC' INTO due_at FROM "mailReminderJob" j
      JOIN "mailReminder" r ON r.id = j."reminderId"
      JOIN "mailbox" m ON m.id = r."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter)
        AND j.kind = 'evaluate' AND j."completedAt" IS NULL;
      SELECT min(greatest(s."availableAt", s."leaseUntil")) AT TIME ZONE 'UTC' INTO pending_at
      FROM "mailReminderSuggestion" s JOIN "mailbox" m ON m.id = s."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter) AND s.status = 'pending';
      due_at := least(due_at, pending_at);
      IF NOT mailbox_lanes THEN
        SELECT min("updatedAt") + interval '30 seconds' INTO pending_at FROM "gmailComposeOperation"
        WHERE kind = 'send' AND status = 'accepted' AND "followUpReminder" IS NOT NULL;
        due_at := least(due_at, pending_at);
      END IF;
    WHEN 'reminder-usage' THEN
      SELECT (least(
        (SELECT min("createdAt") FROM "mailReminderJob"
          WHERE usage IS NOT NULL AND "usageModel" IS NOT NULL AND "usageReportedAt" IS NULL),
        (SELECT min("createdAt") FROM "mailReminderSuggestion"
          WHERE usage IS NOT NULL AND "usageModel" IS NOT NULL AND "usageReportedAt" IS NULL)
      )) AT TIME ZONE 'UTC' INTO due_at;
    WHEN 'memory-events' THEN
      SELECT min(greatest(e."updatedAt", e."processingAt")) + interval '2 minutes'
      INTO due_at FROM "userAiContextEvent" e
      LEFT JOIN "mailbox" m ON m.id = e."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter OR e."mailboxId" IS NULL)
        AND e."mergedAt" IS NULL AND e."skippedAt" IS NULL AND e.metadata->>'memoryScope' = 'user';
    WHEN 'memory-bootstrap' THEN
      SELECT min(CASE s.status
        WHEN 'pending' THEN s."updatedAt"
        WHEN 'processing' THEN s."processingAt" + interval '5 minutes'
        ELSE s."updatedAt" + interval '5 minutes'
      END) INTO due_at FROM "aiMemoryMailboxState" s
      JOIN "mailbox" m ON m.id = s."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter)
        AND m.status = 'connected' AND s.status IN ('pending', 'processing', 'failed')
        AND s."userId" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "aiMemoryScopeConfig" c
          WHERE c."scopeKey" = 'user:' || s."userId" AND NOT c."activeLearningEnabled");
    WHEN 'semantic-index' THEN
      SELECT min(greatest(r."availableAt", r."leaseExpiresAt")) INTO due_at FROM "semanticIndexRequest" r
      JOIN "mailbox" m ON m.id = r."mailboxId"
      WHERE (provider_filter IS NULL OR m.provider = provider_filter)
        AND (r."completedAt" IS NULL OR r."requestedAt" > r."completedAt");
    WHEN 'gmail-body-backfill' THEN
      SELECT coalesce("bodyBackfillAfter", timezone('UTC', now())) INTO due_at
      FROM "gmailCapturedMessage"
      WHERE "deletedAt" IS NULL AND "bodyObject" IS NULL AND snapshot IS NOT NULL
      ORDER BY coalesce("bodyBackfillAfter", '-infinity'::timestamp), "mailboxId", "messageId"
      LIMIT 1;
    ELSE
      RAISE EXCEPTION 'Unknown maintenance task %', task;
  END CASE;
  RETURN ceil(extract(epoch FROM due_at) * 1000);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_release_object() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  released_at timestamp := timezone('UTC', clock_timestamp());
BEGIN
  UPDATE "mailObjectCleanup"
  SET "notBefore" = greatest(released_at, "createdAt" + interval '24 hours')
  WHERE "notBefore" > greatest(released_at, "createdAt" + interval '24 hours') AND provider = OLD."rawObjectProvider"
    AND bucket = OLD."rawObjectBucket" AND key = OLD."rawObjectKey";
  IF TG_TABLE_NAME = 'managedMailMessage' THEN
    UPDATE "mailObjectCleanup"
    SET "notBefore" = greatest(released_at, "createdAt" + interval '24 hours')
    WHERE "notBefore" > greatest(released_at, "createdAt" + interval '24 hours') AND provider = 's3'
      AND bucket = OLD."s3Bucket" AND key = OLD."s3Key";
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_delete AFTER DELETE ON "managedMailMessage"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_update AFTER UPDATE OF "rawObjectProvider", "rawObjectBucket", "rawObjectKey", "s3Bucket", "s3Key" ON "managedMailMessage"
FOR EACH ROW WHEN ((OLD."rawObjectProvider", OLD."rawObjectBucket", OLD."rawObjectKey", OLD."s3Bucket", OLD."s3Key")
  IS DISTINCT FROM (NEW."rawObjectProvider", NEW."rawObjectBucket", NEW."rawObjectKey", NEW."s3Bucket", NEW."s3Key"))
EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_delete AFTER DELETE ON "organizationApiMailMessage"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_update AFTER UPDATE OF "rawObjectProvider", "rawObjectBucket", "rawObjectKey" ON "organizationApiMailMessage"
FOR EACH ROW WHEN ((OLD."rawObjectProvider", OLD."rawObjectBucket", OLD."rawObjectKey")
  IS DISTINCT FROM (NEW."rawObjectProvider", NEW."rawObjectBucket", NEW."rawObjectKey"))
EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_delete AFTER DELETE ON "organizationMailSendIdempotency"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_update AFTER UPDATE OF "rawObjectProvider", "rawObjectBucket", "rawObjectKey" ON "organizationMailSendIdempotency"
FOR EACH ROW WHEN ((OLD."rawObjectProvider", OLD."rawObjectBucket", OLD."rawObjectKey")
  IS DISTINCT FROM (NEW."rawObjectProvider", NEW."rawObjectBucket", NEW."rawObjectKey"))
EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_delete AFTER DELETE ON "scheduledMailSend"
FOR EACH ROW WHEN (OLD."payloadRetiredAt" IS NULL) EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_release_object_update AFTER UPDATE OF "payloadRetiredAt", "rawObjectProvider", "rawObjectBucket", "rawObjectKey" ON "scheduledMailSend"
FOR EACH ROW WHEN (OLD."payloadRetiredAt" IS NULL AND (
  NEW."payloadRetiredAt" IS NOT NULL OR (OLD."rawObjectProvider", OLD."rawObjectBucket", OLD."rawObjectKey")
  IS DISTINCT FROM (NEW."rawObjectProvider", NEW."rawObjectBucket", NEW."rawObjectKey")))
EXECUTE FUNCTION mail_maintenance_release_object();
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_refresh_managed_index() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_mailbox text;
  target_user text;
  source_kind text;
  requested_at timestamp := timezone('UTC', clock_timestamp());
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "mailDispatchSettings" WHERE key = 'mail-dispatch-v1' AND enabled) THEN
    RETURN NEW;
  END IF;
  CASE TG_TABLE_NAME
    WHEN 'managedMailMessage' THEN
      target_mailbox := NEW."mailboxId";
      source_kind := 'mail';
    WHEN 'chatMessage' THEN
      SELECT "mailboxId", "userId" INTO target_mailbox, target_user
      FROM chat WHERE id = NEW."chatId";
      IF target_mailbox IS NULL THEN
        RETURN NEW;
      END IF;
      source_kind := 'chat';
    WHEN 'aiMemory' THEN
      target_mailbox := NEW.metadata->>'sourceMailboxId';
      target_user := NEW."userId";
      source_kind := 'memory';
  END CASE;

  UPDATE "semanticIndexRequest" r
  SET "requestedAt" = greatest(r."requestedAt", requested_at),
      "availableAt" = CASE WHEN r."completedAt" IS NOT NULL AND r."lastError" IS NULL
        AND (r."leaseExpiresAt" IS NULL OR r."leaseExpiresAt" <= requested_at)
        THEN least(r."availableAt", requested_at + interval '30 seconds') ELSE r."availableAt" END
  FROM mailbox m
  WHERE r.kind = source_kind AND m.id = r."mailboxId" AND m.provider = 'managed'
    AND (target_mailbox IS NULL OR m.id = target_mailbox)
    AND (target_user IS NULL OR r."userId" = target_user)
    AND (r."leaseExpiresAt" IS NOT NULL OR r."completedAt" >= r."requestedAt");
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_refresh_managed_index_insert AFTER INSERT ON "managedMailMessage"
FOR EACH ROW WHEN (NEW."mailboxState" IN ('active', 'done')) EXECUTE FUNCTION mail_maintenance_refresh_managed_index();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_refresh_managed_index_update AFTER UPDATE OF "bodyText", "bodyHtml", subject, analysis, "mailboxState" ON "managedMailMessage"
FOR EACH ROW WHEN (NEW."mailboxState" IN ('active', 'done') AND (
  OLD."bodyText" IS DISTINCT FROM NEW."bodyText" OR OLD.subject IS DISTINCT FROM NEW.subject
  OR OLD.analysis->'htmlText' IS DISTINCT FROM NEW.analysis->'htmlText'
  OR (OLD."mailboxState" NOT IN ('active', 'done'))
)) EXECUTE FUNCTION mail_maintenance_refresh_managed_index();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_refresh_managed_index AFTER INSERT OR UPDATE OF parts ON "chatMessage"
FOR EACH ROW WHEN (NEW.role IN ('user', 'assistant')) EXECUTE FUNCTION mail_maintenance_refresh_managed_index();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_refresh_managed_index AFTER INSERT OR UPDATE OF version, status ON "aiMemory"
FOR EACH ROW WHEN (NEW.scope = 'user' AND NEW.status = 'active') EXECUTE FUNCTION mail_maintenance_refresh_managed_index();
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_enroll_memory() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  now_ms double precision := extract(epoch FROM statement_timestamp()) * 1000;
BEGIN
  IF TG_TABLE_NAME = 'aiMemoryScopeConfig' THEN
    PERFORM mail_maintenance_enqueue('memory-enroll', now_ms, m.id)
    FROM "mailbox" m WHERE m.status = 'connected' AND (
      (m.provider = 'gmail' AND m."ownerUserId" = NEW."userId")
      OR (m.provider = 'managed' AND m."accessMode" = 'private' AND m."managedOwnerUserId" = NEW."userId")
    );
    PERFORM mail_maintenance_enqueue('memory-bootstrap', now_ms);
    RETURN NEW;
  END IF;
  IF NEW.provider = 'managed' AND NEW.status = 'connected' AND NEW."accessMode" = 'private'
     AND NEW."managedOwnerUserId" IS NOT NULL AND (TG_OP = 'INSERT'
       OR (NEW.status, NEW."accessMode", NEW."managedOwnerUserId")
          IS DISTINCT FROM (OLD.status, OLD."accessMode", OLD."managedOwnerUserId")
     ) THEN
    PERFORM mail_maintenance_enqueue('memory-enroll', now_ms, NEW.id);
    PERFORM mail_maintenance_enqueue('memory-bootstrap', now_ms);
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_enroll_memory AFTER INSERT OR UPDATE OF status, "accessMode", "managedOwnerUserId" ON "mailbox"
FOR EACH ROW EXECUTE FUNCTION mail_maintenance_enroll_memory();
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_enroll_memory AFTER UPDATE OF "activeLearningEnabled" ON "aiMemoryScopeConfig"
FOR EACH ROW WHEN (NEW.scope = 'user' AND NEW."activeLearningEnabled" AND NOT OLD."activeLearningEnabled")
EXECUTE FUNCTION mail_maintenance_enroll_memory();
--> statement-breakpoint
CREATE FUNCTION mail_maintenance_resume_managed_codes() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM mail_maintenance_enqueue('managed-codes', extract(epoch FROM statement_timestamp()) * 1000);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER mail_maintenance_resume_managed_codes AFTER UPDATE OF "billingOwnerUserId" ON "organization"
FOR EACH ROW WHEN (NEW."billingOwnerUserId" IS NOT NULL AND NEW."billingOwnerUserId" IS DISTINCT FROM OLD."billingOwnerUserId")
EXECUTE FUNCTION mail_maintenance_resume_managed_codes();
