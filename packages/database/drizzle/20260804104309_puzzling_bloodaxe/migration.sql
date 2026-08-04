CREATE TABLE "aiMemory" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"kind" text NOT NULL,
	"scopeKey" text NOT NULL,
	"userId" text,
	"mailboxId" text,
	"key" text NOT NULL,
	"content" text NOT NULL,
	"summary" text NOT NULL,
	"metadata" jsonb DEFAULT '{}' NOT NULL,
	"source" text NOT NULL,
	"sourceReference" text,
	"status" text DEFAULT 'active' NOT NULL,
	"confidence" double precision DEFAULT 0.75 NOT NULL,
	"importance" integer DEFAULT 3 NOT NULL,
	"reinforcementCount" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expiresAt" timestamp,
	"archivedAt" timestamp,
	"lastConfirmedAt" timestamp NOT NULL,
	"lastUsedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "ai_memory_scope_key_memory_key_unique" UNIQUE("scopeKey","key"),
	CONSTRAINT "ai_memory_scope_check" CHECK ("scope" in ('mailbox', 'user')),
	CONSTRAINT "ai_memory_kind_check" CHECK ("kind" in ('instruction', 'learned')),
	CONSTRAINT "ai_memory_status_check" CHECK ("status" in ('active', 'archived')),
	CONSTRAINT "ai_memory_source_check" CHECK ("source" in ('explicit', 'feedback', 'inferred', 'migration')),
	CONSTRAINT "ai_memory_scope_owner_check" CHECK ((
        ("scope" = 'user' and "userId" is not null and "mailboxId" is null)
        or
        ("scope" = 'mailbox' and "userId" is null and "mailboxId" is not null)
      )),
	CONSTRAINT "ai_memory_key_length_check" CHECK (char_length("key") between 1 and 200),
	CONSTRAINT "ai_memory_content_length_check" CHECK (char_length("content") between 1 and 2000),
	CONSTRAINT "ai_memory_summary_length_check" CHECK (char_length("summary") between 1 and 300),
	CONSTRAINT "ai_memory_confidence_check" CHECK ("confidence" between 0 and 1),
	CONSTRAINT "ai_memory_importance_check" CHECK ("importance" between 1 and 5),
	CONSTRAINT "ai_memory_reinforcement_count_check" CHECK ("reinforcementCount" >= 1)
);
--> statement-breakpoint
CREATE TABLE "aiMemoryChangeSet" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"mailboxId" text,
	"source" text NOT NULL,
	"sourceEventId" text CONSTRAINT "ai_memory_change_set_source_event_unique" UNIQUE,
	"request" text,
	"status" text NOT NULL,
	"summary" text NOT NULL,
	"changes" jsonb DEFAULT '[]' NOT NULL,
	"error" text,
	"undoOfId" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "ai_memory_change_set_source_check" CHECK ("source" in ('chat', 'feedback', 'migration', 'settings', 'system')),
	CONSTRAINT "ai_memory_change_set_status_check" CHECK ("status" in ('applied', 'failed', 'no_change')),
	CONSTRAINT "ai_memory_change_set_request_length_check" CHECK (char_length("request") <= 2000),
	CONSTRAINT "ai_memory_change_set_summary_length_check" CHECK (char_length("summary") <= 500)
);
--> statement-breakpoint
CREATE TABLE "aiMemoryScopeConfig" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"scopeKey" text NOT NULL CONSTRAINT "ai_memory_scope_config_scope_key_unique" UNIQUE,
	"userId" text,
	"mailboxId" text,
	"activeLearningEnabled" boolean DEFAULT true NOT NULL,
	"learningPrompt" text DEFAULT '' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "ai_memory_scope_config_scope_check" CHECK ("scope" in ('mailbox', 'user')),
	CONSTRAINT "ai_memory_scope_config_owner_check" CHECK ((
        ("scope" = 'user' and "userId" is not null and "mailboxId" is null)
        or
        ("scope" = 'mailbox' and "userId" is null and "mailboxId" is not null)
      )),
	CONSTRAINT "ai_memory_scope_config_learning_prompt_length_check" CHECK (char_length("learningPrompt") <= 6000)
);
--> statement-breakpoint
ALTER TABLE "userAiContextEvent" ADD COLUMN "processingAt" timestamp;--> statement-breakpoint
CREATE INDEX "ai_memory_user_status_updated_idx" ON "aiMemory" ("userId","status","updatedAt");--> statement-breakpoint
CREATE INDEX "ai_memory_mailbox_status_updated_idx" ON "aiMemory" ("mailboxId","status","updatedAt");--> statement-breakpoint
CREATE INDEX "ai_memory_expiration_idx" ON "aiMemory" ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "ai_memory_change_set_user_created_idx" ON "aiMemoryChangeSet" ("userId","createdAt");--> statement-breakpoint
CREATE INDEX "ai_memory_change_set_mailbox_created_idx" ON "aiMemoryChangeSet" ("mailboxId","createdAt");--> statement-breakpoint
ALTER TABLE "aiMemory" ADD CONSTRAINT "aiMemory_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemory" ADD CONSTRAINT "aiMemory_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryChangeSet" ADD CONSTRAINT "aiMemoryChangeSet_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryChangeSet" ADD CONSTRAINT "aiMemoryChangeSet_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryChangeSet" ADD CONSTRAINT "aiMemoryChangeSet_sourceEventId_userAiContextEvent_id_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "userAiContextEvent"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "aiMemoryScopeConfig" ADD CONSTRAINT "aiMemoryScopeConfig_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "aiMemoryScopeConfig" ADD CONSTRAINT "aiMemoryScopeConfig_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "userAiContextEvent" DROP CONSTRAINT "user_ai_context_event_kind_check", ADD CONSTRAINT "user_ai_context_event_kind_check" CHECK ("kind" in ('auto_label_feedback', 'chat_discovery', 'explicit_preference', 'mail_action', 'sent_message', 'useful_detail_feedback'));
--> statement-breakpoint
-- Preserve the former aggregate Markdown as personal learned knowledge. Legacy columns stay in
-- place for this expand migration, but application code no longer reads or writes them.
INSERT INTO "aiMemory" (
	"id", "scope", "kind", "scopeKey", "userId", "mailboxId", "key", "content", "summary",
	"metadata", "source", "sourceReference", "status", "confidence", "importance",
	"reinforcementCount", "version", "lastConfirmedAt", "createdAt", "updatedAt"
)
SELECT
	'legacy-context:' || context."id" || ':' || chunk."number",
	'user', 'learned', 'user:' || context."userId", context."userId", NULL,
	'legacy-profile:' || chunk."number",
	btrim(substr(context."markdown", ((chunk."number" - 1) * 1900) + 1, 1900)),
	'Imported legacy AI profile (part ' || chunk."number" || ')',
	jsonb_build_object('agents', jsonb_build_array('all'), 'topics', jsonb_build_array('legacy-profile')),
	'migration', context."id", 'active', 0.8, 5, 1, 1,
	context."updatedAt", context."createdAt", context."updatedAt"
FROM "userAiContext" context
CROSS JOIN LATERAL generate_series(1, ceil(char_length(context."markdown") / 1900.0)::integer) AS chunk("number")
WHERE btrim(context."markdown") <> ''
	AND btrim(substr(context."markdown", ((chunk."number" - 1) * 1900) + 1, 1900)) <> ''
ON CONFLICT ("scopeKey", "key") DO NOTHING;
--> statement-breakpoint
-- Carry forward explicit preferences that had not reached the old aggregate profile.
INSERT INTO "aiMemory" (
	"id", "scope", "kind", "scopeKey", "userId", "mailboxId", "key", "content", "summary",
	"metadata", "source", "sourceReference", "status", "confidence", "importance",
	"reinforcementCount", "version", "lastConfirmedAt", "createdAt", "updatedAt"
)
SELECT
	'legacy-event:' || event."id", 'user', 'learned', 'user:' || event."userId",
	event."userId", NULL, 'legacy-event:' || event."id",
	left(btrim(event."metadata"->>'preference'), 2000),
	left(btrim(event."metadata"->>'preference'), 300),
	jsonb_build_object('agents', jsonb_build_array('all'), 'topics', jsonb_build_array('chat-preference')),
	'explicit', event."id", 'active', 0.95, 5, 1, 1,
	event."createdAt", event."createdAt", event."updatedAt"
FROM "userAiContextEvent" event
WHERE event."kind" IN ('chat_discovery', 'explicit_preference')
	AND event."mergedAt" IS NULL AND event."skippedAt" IS NULL
	AND btrim(event."metadata"->>'preference') <> ''
ON CONFLICT ("scopeKey", "key") DO NOTHING;
--> statement-breakpoint
UPDATE "userAiContextEvent"
SET "mergedAt" = now(), "lastError" = NULL, "updatedAt" = now()
WHERE "kind" IN ('chat_discovery', 'explicit_preference')
	AND "mergedAt" IS NULL AND "skippedAt" IS NULL
	AND btrim("metadata"->>'preference') <> '';
--> statement-breakpoint
-- Convert compact automation profiles into mailbox-scoped learned facts. Raw feedback remains as
-- evidence and is removed when a manager deletes all mailbox knowledge.
INSERT INTO "aiMemory" (
	"id", "scope", "kind", "scopeKey", "userId", "mailboxId", "key", "content", "summary",
	"metadata", "source", "sourceReference", "status", "confidence", "importance",
	"reinforcementCount", "version", "lastConfirmedAt", "createdAt", "updatedAt"
)
SELECT
	'legacy-automation:' || profile."id" || ':' || rule."ordinality",
	'mailbox', 'learned', 'mailbox:' || profile."mailboxId", NULL, profile."mailboxId",
	'feedback:' || profile."agent" || ':legacy:' || profile."id" || ':' || rule."ordinality",
	left(
		CASE WHEN profile."agent" = 'auto_label' THEN
			CASE WHEN rule."value"->>'policy' = 'prefer' THEN 'Prefer applying ' ELSE 'Avoid applying ' END
			|| 'the “' || coalesce(rule."value"->>'labelName', rule."value"->>'labelId', 'unknown') || '” label'
			|| CASE WHEN nullif(rule."value"->>'source', '') IS NOT NULL THEN ' to messages from ' || (rule."value"->>'source') ELSE ' when it clearly matches' END || '.'
		ELSE
			CASE WHEN rule."value"->>'policy' = 'prefer' THEN 'Treat ' ELSE 'Do not treat ' END
			|| replace(coalesce(rule."value"->>'kind', 'unknown'), '_', ' ') || ' details'
			|| CASE WHEN nullif(rule."value"->>'source', '') IS NOT NULL THEN ' from ' || (rule."value"->>'source') ELSE ' across this mailbox' END || ' as useful.'
		END,
		2000
	),
	left(
		CASE WHEN rule."value"->>'policy' = 'prefer' THEN 'Prefers ' ELSE 'Suppresses ' END
		|| CASE WHEN profile."agent" = 'auto_label'
			THEN coalesce(rule."value"->>'labelName', rule."value"->>'labelId', 'label')
			ELSE replace(coalesce(rule."value"->>'kind', 'detail'), '_', ' ')
		END,
		300
	),
	jsonb_strip_nulls(jsonb_build_object(
		'agents', jsonb_build_array(profile."agent"),
		'topics', jsonb_build_array(profile."agent", coalesce(rule."value"->>'kind', rule."value"->>'labelName', rule."value"->>'labelId')),
		'sourceDomains', CASE WHEN nullif(rule."value"->>'source', '') IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(rule."value"->>'source') END,
		'policy', rule."value"->>'policy',
		'detailKind', CASE WHEN profile."agent" = 'useful_detail' THEN rule."value"->>'kind' END,
		'labelId', CASE WHEN profile."agent" = 'auto_label' THEN rule."value"->>'labelId' END
	)),
	'feedback', profile."id", 'active', 0.8,
	CASE WHEN nullif(rule."value"->>'source', '') IS NULL THEN 3 ELSE 4 END,
	CASE WHEN coalesce(rule."value"->>'count', '') ~ '^[0-9]+$' THEN greatest((rule."value"->>'count')::integer, 1) ELSE 1 END,
	1, profile."lastMergedAt", profile."createdAt", profile."updatedAt"
FROM "mailAutomationMemoryProfile" profile
CROSS JOIN LATERAL jsonb_array_elements(
	CASE WHEN jsonb_typeof(profile."profile"->'rules') = 'array' THEN profile."profile"->'rules' ELSE '[]'::jsonb END
) WITH ORDINALITY AS rule("value", "ordinality")
WHERE rule."value"->>'policy' IN ('prefer', 'suppress')
ON CONFLICT ("scopeKey", "key") DO NOTHING;
