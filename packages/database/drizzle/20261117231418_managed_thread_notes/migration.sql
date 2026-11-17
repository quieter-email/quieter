-- quieter:contract
CREATE TABLE "managedThreadNote" (
	"authorMemberId" text,
	"body" text NOT NULL,
	"contextId" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_thread_note_body_check" CHECK (char_length("body") <= 10000 and "body" ~ '[^[:space:]]'),
	CONSTRAINT "managed_thread_note_time_check" CHECK ("updatedAt" >= "createdAt")
);
--> statement-breakpoint
CREATE TABLE "managedThreadNoteMention" (
	"createdAt" timestamp NOT NULL,
	"noteId" text,
	"readAt" timestamp,
	"recipientMemberId" text,
	CONSTRAINT "managed_thread_note_mention_pkey" PRIMARY KEY("noteId","recipientMemberId"),
	CONSTRAINT "managed_thread_note_mention_time_check" CHECK ("readAt" is null or "readAt" >= "createdAt")
);
--> statement-breakpoint
ALTER TABLE "managedThreadCollaborationEvent" ADD COLUMN "noteId" text;--> statement-breakpoint
CREATE INDEX "managed_thread_note_context_created_idx" ON "managedThreadNote" ("contextId","createdAt","id");--> statement-breakpoint
CREATE INDEX "managed_thread_note_author_idx" ON "managedThreadNote" ("authorMemberId");--> statement-breakpoint
CREATE INDEX "managed_thread_note_mention_recipient_idx" ON "managedThreadNoteMention" ("recipientMemberId","readAt","createdAt","noteId");--> statement-breakpoint
ALTER TABLE "managedThreadNote" ADD CONSTRAINT "managedThreadNote_authorMemberId_member_id_fkey" FOREIGN KEY ("authorMemberId") REFERENCES "member"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managedThreadNote" ADD CONSTRAINT "managedThreadNote_contextId_managedThreadCollaboration_id_fkey" FOREIGN KEY ("contextId") REFERENCES "managedThreadCollaboration"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedThreadNoteMention" ADD CONSTRAINT "managedThreadNoteMention_noteId_managedThreadNote_id_fkey" FOREIGN KEY ("noteId") REFERENCES "managedThreadNote"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedThreadNoteMention" ADD CONSTRAINT "managedThreadNoteMention_recipientMemberId_member_id_fkey" FOREIGN KEY ("recipientMemberId") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedThreadCollaborationEvent" DROP CONSTRAINT "managed_thread_collaboration_event_kind_check", ADD CONSTRAINT "managed_thread_collaboration_event_kind_check" CHECK (("kind" = 'prepared' and "noteId" is null)
        or ("kind" in ('note_created', 'note_edited', 'note_deleted') and "noteId" is not null));