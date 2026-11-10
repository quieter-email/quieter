-- quieter:contract
WITH normalized AS (
  SELECT rule.id, (
    SELECT coalesce(jsonb_agg(action ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(rule.actions) WITH ORDINALITY AS item(action, position)
    WHERE NOT action @> '{"kind":"move","destination":"archive"}'::jsonb
  ) AS actions
  FROM "managedMailRule" AS rule
  WHERE rule.actions @> '[{"kind":"move","destination":"archive"}]'::jsonb
), updated_rules AS (
  UPDATE "managedMailRule" AS rule
  SET actions = normalized.actions,
      enabled = rule.enabled AND normalized.actions <> '[]'::jsonb,
      "disabledReason" = CASE WHEN normalized.actions = '[]'::jsonb
        THEN 'Archive was removed. Add an action before enabling this rule.'
        ELSE rule."disabledReason" END,
      "updatedAt" = now()
  FROM normalized
  WHERE rule.id = normalized.id
  RETURNING rule.id, rule.actions
)
UPDATE "managedMailRuleBackfill" AS job
SET status = 'cancelled', "cancelledAt" = now(),
    "leaseId" = NULL, "leasedUntil" = NULL,
    "lastError" = 'Archive was removed.', "updatedAt" = now()
FROM updated_rules
WHERE job."ruleId" = updated_rules.id
  AND updated_rules.actions = '[]'::jsonb
  AND job.status IN ('pending', 'running', 'failed');
--> statement-breakpoint
WITH normalized AS (
  SELECT job.id, (
    SELECT coalesce(jsonb_agg(action ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(job.definition->'actions') WITH ORDINALITY AS item(action, position)
    WHERE NOT action @> '{"kind":"move","destination":"archive"}'::jsonb
  ) AS actions
  FROM "managedMailRuleBackfill" AS job
  WHERE job.definition->'actions' @> '[{"kind":"move","destination":"archive"}]'::jsonb
    AND job.status IN ('pending', 'running', 'failed')
)
UPDATE "managedMailRuleBackfill" AS job
SET definition = CASE WHEN normalized.actions = '[]'::jsonb THEN NULL
      ELSE jsonb_set(job.definition, '{actions}', normalized.actions) END,
    status = CASE WHEN normalized.actions = '[]'::jsonb THEN 'cancelled' ELSE job.status END,
    "cancelledAt" = CASE WHEN normalized.actions = '[]'::jsonb THEN now() ELSE job."cancelledAt" END,
    "leaseId" = CASE WHEN normalized.actions = '[]'::jsonb THEN NULL ELSE job."leaseId" END,
    "leasedUntil" = CASE WHEN normalized.actions = '[]'::jsonb THEN NULL ELSE job."leasedUntil" END,
    "lastError" = CASE WHEN normalized.actions = '[]'::jsonb THEN 'Archive was removed.' ELSE job."lastError" END,
    "updatedAt" = now()
FROM normalized
WHERE job.id = normalized.id;
--> statement-breakpoint
WITH normalized AS (
  SELECT run.id, (
    SELECT coalesce(jsonb_agg(action ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(run.definition->'actions') WITH ORDINALITY AS item(action, position)
    WHERE NOT action @> '{"kind":"move","destination":"archive"}'::jsonb
  ) AS actions, (
    SELECT coalesce(jsonb_agg(result ORDER BY position), '[]'::jsonb)
    FROM jsonb_array_elements(run."actionResults") WITH ORDINALITY AS item(result, position)
    WHERE NOT (run.definition->'actions'->(position::integer - 1)) @> '{"kind":"move","destination":"archive"}'::jsonb
  ) AS results,
  run."completedAt" IS NULL AND EXISTS (
    SELECT 1
    FROM jsonb_array_elements(run.definition->'actions') WITH ORDINALITY AS removed(action, position)
    JOIN jsonb_array_elements(run.definition->'actions') WITH ORDINALITY AS pending(action, position)
      ON pending.position > removed.position
      AND pending.position > jsonb_array_length(run."actionResults")
    WHERE removed.action @> '{"kind":"move","destination":"archive"}'::jsonb
      AND pending.action->>'kind' = 'forward'
  ) AS unsafe_forward
  FROM "managedMailRuleRun" AS run
  WHERE run.definition->'actions' @> '[{"kind":"move","destination":"archive"}]'::jsonb
)
UPDATE "managedMailRuleRun" AS run
SET definition = jsonb_set(run.definition, '{actions}', CASE WHEN normalized.unsafe_forward THEN (
      SELECT coalesce(jsonb_agg(action ORDER BY position), '[]'::jsonb)
      FROM jsonb_array_elements(normalized.actions) WITH ORDINALITY AS item(action, position)
      WHERE position <= jsonb_array_length(normalized.results)
    ) ELSE normalized.actions END),
    "actionResults" = normalized.results,
    "completedAt" = CASE WHEN normalized.actions = '[]'::jsonb OR normalized.unsafe_forward
      THEN coalesce(run."completedAt", now()) ELSE run."completedAt" END,
    error = CASE WHEN normalized.unsafe_forward THEN 'A previous automatic forward needs review before retrying.'
      WHEN normalized.actions = '[]'::jsonb AND run."completedAt" IS NULL THEN 'Archive was removed.'
      ELSE run.error END,
    "updatedAt" = now()
FROM normalized
WHERE run.id = normalized.id;
