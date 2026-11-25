-- quieter:contract
CREATE TABLE "managedThreadCollaboration" (
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"threadId" text NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_thread_collaboration_scope_unique" UNIQUE("mailboxId","threadId"),
	CONSTRAINT "managed_thread_collaboration_revision_check" CHECK ("revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "managedThreadCollaborationEvent" (
	"actorMemberId" text,
	"contextId" text,
	"createdAt" timestamp NOT NULL,
	"kind" text NOT NULL,
	"revision" bigint,
	CONSTRAINT "managed_thread_collaboration_event_pkey" PRIMARY KEY("contextId","revision"),
	CONSTRAINT "managed_thread_collaboration_event_revision_check" CHECK ("revision" > 0),
	CONSTRAINT "managed_thread_collaboration_event_kind_check" CHECK ("kind" = 'prepared')
);
--> statement-breakpoint
CREATE INDEX "managed_thread_collaboration_event_actor_idx" ON "managedThreadCollaborationEvent" ("actorMemberId");--> statement-breakpoint
ALTER TABLE "managedThreadCollaboration" ADD CONSTRAINT "managedThreadCollaboration_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedThreadCollaborationEvent" ADD CONSTRAINT "managedThreadCollaborationEvent_actorMemberId_member_id_fkey" FOREIGN KEY ("actorMemberId") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedThreadCollaborationEvent" ADD CONSTRAINT "managedThreadCollaborationEvent_FX852TcF0JUQ_fkey" FOREIGN KEY ("contextId") REFERENCES "managedThreadCollaboration"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE FUNCTION "quieter_cleanup_deleted_collaboration"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE scope record;
BEGIN
  FOR scope IN
    SELECT DISTINCT "mailboxId", "threadId" FROM old_messages ORDER BY "mailboxId", "threadId"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
      'quieter-managed-collaboration-v1', scope."mailboxId", scope."threadId")::text, 0));
    DELETE FROM "managedThreadCollaboration" c
    WHERE c."mailboxId" = scope."mailboxId" AND c."threadId" = scope."threadId"
      AND NOT EXISTS (SELECT 1 FROM "managedMailMessage" m
        WHERE m."mailboxId" = c."mailboxId" AND m."threadId" = c."threadId");
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "managed_thread_collaboration_delete_empty"
AFTER DELETE ON "managedMailMessage"
REFERENCING OLD TABLE AS old_messages
FOR EACH STATEMENT EXECUTE FUNCTION "quieter_cleanup_deleted_collaboration"();

--> statement-breakpoint
CREATE FUNCTION "quieter_cleanup_moved_collaboration"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE scope record;
BEGIN
  FOR scope IN
    SELECT "mailboxId", "threadId" FROM old_messages
    EXCEPT SELECT "mailboxId", "threadId" FROM new_messages
    ORDER BY "mailboxId", "threadId"
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
      'quieter-managed-collaboration-v1', scope."mailboxId", scope."threadId")::text, 0));
    DELETE FROM "managedThreadCollaboration" c
    WHERE c."mailboxId" = scope."mailboxId" AND c."threadId" = scope."threadId"
      AND NOT EXISTS (SELECT 1 FROM "managedMailMessage" m
        WHERE m."mailboxId" = c."mailboxId" AND m."threadId" = c."threadId");
  END LOOP;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "managed_thread_collaboration_move_empty"
AFTER UPDATE ON "managedMailMessage"
REFERENCING OLD TABLE AS old_messages NEW TABLE AS new_messages
FOR EACH STATEMENT EXECUTE FUNCTION "quieter_cleanup_moved_collaboration"();
