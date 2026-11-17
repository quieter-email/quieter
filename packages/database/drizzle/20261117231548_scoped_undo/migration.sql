-- quieter:contract
CREATE TABLE "mailMessageIntent" (
	"destinationIntentToken" text,
	"mailboxId" text,
	"messageId" text,
	"readIntentToken" text,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_message_intent_pkey" PRIMARY KEY("mailboxId","messageId")
);
--> statement-breakpoint
CREATE TABLE "mailMessageOperation" (
	"actorUserId" text NOT NULL,
	"code" text,
	"command" jsonb NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"message" text,
	"messageIds" jsonb NOT NULL,
	"requestHash" text NOT NULL,
	"requestId" text NOT NULL,
	"status" text NOT NULL,
	"threadId" text NOT NULL,
	"undoProof" jsonb,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_message_operation_request_unique" UNIQUE("actorUserId","mailboxId","requestId","threadId"),
	CONSTRAINT "mail_message_operation_status_check" CHECK ("status" in ('pending', 'submitting', 'applied', 'failed', 'uncertain', 'superseded')),
	CONSTRAINT "mail_message_operation_message_ids_check" CHECK (case when jsonb_typeof("messageIds") = 'array'
        then jsonb_array_length("messageIds") <= 1000 else false end)
);
--> statement-breakpoint
CREATE TABLE "mailUndoAttempt" (
	"actorUserId" text NOT NULL,
	"admittedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"cutoff" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"items" jsonb DEFAULT '[]' NOT NULL,
	"liveActorUserId" text,
	"liveMessageOperationId" text,
	"livePlacementOperationId" text,
	"liveSnoozeOperationId" text,
	"mailboxId" text NOT NULL,
	"originalKind" text NOT NULL,
	"originalOperationId" text NOT NULL,
	"plan" jsonb,
	"progress" jsonb,
	"state" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_undo_attempt_original_unique" UNIQUE("originalKind","originalOperationId"),
	CONSTRAINT "mail_undo_attempt_kind_check" CHECK ("originalKind" in ('message', 'placement', 'snooze')),
	CONSTRAINT "mail_undo_attempt_state_check" CHECK ("state" in ('accepted', 'submitting', 'completed', 'uncertain')),
	CONSTRAINT "mail_undo_attempt_admission_check" CHECK ("admittedAt" < "cutoff"),
	CONSTRAINT "mail_undo_attempt_live_actor_check" CHECK ("liveActorUserId" is null or "liveActorUserId" = "actorUserId"),
	CONSTRAINT "mail_undo_attempt_live_original_check" CHECK (("liveMessageOperationId" is null or ("originalKind" = 'message' and "liveMessageOperationId" = "originalOperationId"))
        and ("livePlacementOperationId" is null or ("originalKind" = 'placement' and "livePlacementOperationId" = "originalOperationId"))
        and ("liveSnoozeOperationId" is null or ("originalKind" = 'snooze' and "liveSnoozeOperationId" = "originalOperationId"))),
	CONSTRAINT "mail_undo_attempt_items_check" CHECK (case when jsonb_typeof("items") = 'array'
        then jsonb_array_length("items") <= 1000 and ("state" = 'accepted' or jsonb_array_length("items") > 0)
        else false end),
	CONSTRAINT "mail_undo_attempt_plan_check" CHECK ("plan" is null or jsonb_typeof("plan") = 'object')
);
--> statement-breakpoint
ALTER TABLE "mailPlacementOperation" ADD COLUMN "undoProof" jsonb;--> statement-breakpoint
ALTER TABLE "mailSnoozeOperation" ADD COLUMN "undoProof" jsonb;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "destinationRevision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD COLUMN "readRevision" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "mail_message_operation_actor_created_idx" ON "mailMessageOperation" ("actorUserId","createdAt");--> statement-breakpoint
CREATE INDEX "mail_message_operation_mailbox_idx" ON "mailMessageOperation" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mail_undo_attempt_mailbox_idx" ON "mailUndoAttempt" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mail_undo_attempt_live_actor_idx" ON "mailUndoAttempt" ("liveActorUserId") WHERE "liveActorUserId" is not null;--> statement-breakpoint
CREATE INDEX "mail_undo_attempt_live_message_idx" ON "mailUndoAttempt" ("liveMessageOperationId") WHERE "liveMessageOperationId" is not null;--> statement-breakpoint
CREATE INDEX "mail_undo_attempt_live_placement_idx" ON "mailUndoAttempt" ("livePlacementOperationId") WHERE "livePlacementOperationId" is not null;--> statement-breakpoint
CREATE INDEX "mail_undo_attempt_live_snooze_idx" ON "mailUndoAttempt" ("liveSnoozeOperationId") WHERE "liveSnoozeOperationId" is not null;--> statement-breakpoint
ALTER TABLE "mailMessageIntent" ADD CONSTRAINT "mailMessageIntent_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailMessageOperation" ADD CONSTRAINT "mailMessageOperation_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailMessageOperation" ADD CONSTRAINT "mailMessageOperation_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailUndoAttempt" ADD CONSTRAINT "mailUndoAttempt_liveActorUserId_user_id_fkey" FOREIGN KEY ("liveActorUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailUndoAttempt" ADD CONSTRAINT "mailUndoAttempt_hmPQEQdabrAg_fkey" FOREIGN KEY ("liveMessageOperationId") REFERENCES "mailMessageOperation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailUndoAttempt" ADD CONSTRAINT "mailUndoAttempt_ZeBM1IkRCUFS_fkey" FOREIGN KEY ("livePlacementOperationId") REFERENCES "mailPlacementOperation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailUndoAttempt" ADD CONSTRAINT "mailUndoAttempt_xjlVVY9pYYVQ_fkey" FOREIGN KEY ("liveSnoozeOperationId") REFERENCES "mailSnoozeOperation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailUndoAttempt" ADD CONSTRAINT "mailUndoAttempt_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD CONSTRAINT "managed_mail_message_read_revision_check" CHECK ("readRevision" >= 0);--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD CONSTRAINT "managed_mail_message_destination_revision_check" CHECK ("destinationRevision" >= 0);
--> statement-breakpoint
CREATE FUNCTION "quieter_advance_managed_read_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."readRevision" := OLD."readRevision" + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "managed_mail_read_revision"
BEFORE UPDATE OF "isRead" ON "managedMailMessage"
FOR EACH ROW EXECUTE FUNCTION "quieter_advance_managed_read_revision"();
--> statement-breakpoint
CREATE FUNCTION "quieter_advance_managed_destination_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."destinationRevision" := OLD."destinationRevision" + 1;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "managed_mail_destination_revision"
BEFORE UPDATE OF "mailboxState" ON "managedMailMessage"
FOR EACH ROW EXECUTE FUNCTION "quieter_advance_managed_destination_revision"();
--> statement-breakpoint
CREATE FUNCTION "quieter_preserve_mail_undo_identity"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.id, NEW."actorUserId", NEW."mailboxId", NEW."originalKind",
    NEW."originalOperationId", NEW."admittedAt", NEW.cutoff, NEW."createdAt")
    IS DISTINCT FROM
    ROW(OLD.id, OLD."actorUserId", OLD."mailboxId", OLD."originalKind",
    OLD."originalOperationId", OLD."admittedAt", OLD.cutoff, OLD."createdAt")
    OR (OLD.plan IS NOT NULL AND NEW.plan IS DISTINCT FROM OLD.plan)
  THEN
    RAISE EXCEPTION 'An accepted Undo identity and captured plan cannot change'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "mail_undo_preserve_identity"
BEFORE UPDATE ON "mailUndoAttempt"
FOR EACH ROW EXECUTE FUNCTION "quieter_preserve_mail_undo_identity"();
