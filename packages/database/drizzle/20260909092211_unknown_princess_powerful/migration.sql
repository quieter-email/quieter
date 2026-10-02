CREATE TABLE "mailSyncChange" (
	"changes" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"epoch" text NOT NULL,
	"mailboxId" text,
	"sequence" bigint,
	CONSTRAINT "mailSyncChange_pkey" PRIMARY KEY("mailboxId","sequence")
);
--> statement-breakpoint
CREATE TABLE "mailSyncCommand" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"commandId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"error" text,
	"leaseId" text,
	"mailboxId" text,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"payloadHash" text NOT NULL,
	"status" text DEFAULT 'accepted' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "mailSyncCommand_pkey" PRIMARY KEY("mailboxId","commandId")
);
--> statement-breakpoint
CREATE TABLE "mailSyncEntity" (
	"data" jsonb,
	"entityId" text,
	"kind" text,
	"mailboxId" text,
	"providerGeneration" text,
	"sortAt" timestamp with time zone DEFAULT now() NOT NULL,
	"threadId" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"version" bigint NOT NULL,
	CONSTRAINT "mailSyncEntity_pkey" PRIMARY KEY("mailboxId","kind","entityId")
);
--> statement-breakpoint
CREATE TABLE "mailSyncOutbox" (
	"attempts" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"mailboxId" text,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"sequence" bigint,
	CONSTRAINT "mailSyncOutbox_pkey" PRIMARY KEY("mailboxId","sequence")
);
--> statement-breakpoint
CREATE TABLE "mailSyncProviderState" (
	"bootstrapCursor" text,
	"cursor" text,
	"historyPageToken" text,
	"inventoryGeneration" text,
	"labelsSyncedAt" timestamp with time zone,
	"lastSyncedAt" timestamp with time zone,
	"leaseExpiresAt" timestamp with time zone,
	"leaseId" text,
	"mailboxId" text PRIMARY KEY,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"pageToken" text,
	"phase" text DEFAULT 'bootstrap' NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailSyncStream" (
	"epoch" text NOT NULL,
	"initialized" boolean DEFAULT false NOT NULL,
	"mailboxId" text PRIMARY KEY,
	"replayFloor" bigint DEFAULT 0 NOT NULL,
	"sequence" bigint DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mail_sync_stream_sequence_check" CHECK ("sequence" >= "replayFloor" and "replayFloor" >= 0)
);
--> statement-breakpoint
CREATE INDEX "mail_sync_change_retention_idx" ON "mailSyncChange" ("createdAt");--> statement-breakpoint
CREATE INDEX "mail_sync_command_due_idx" ON "mailSyncCommand" ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "mail_sync_command_user_idx" ON "mailSyncCommand" ("userId","mailboxId","createdAt");--> statement-breakpoint
CREATE INDEX "mail_sync_entity_thread_idx" ON "mailSyncEntity" ("mailboxId","threadId");--> statement-breakpoint
CREATE INDEX "mail_sync_entity_page_idx" ON "mailSyncEntity" ("mailboxId","kind","sortAt","entityId");--> statement-breakpoint
CREATE INDEX "mail_sync_outbox_due_idx" ON "mailSyncOutbox" ("nextAttemptAt");--> statement-breakpoint
ALTER TABLE "mailSyncChange" ADD CONSTRAINT "mailSyncChange_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncCommand" ADD CONSTRAINT "mailSyncCommand_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncCommand" ADD CONSTRAINT "mailSyncCommand_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncEntity" ADD CONSTRAINT "mailSyncEntity_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncOutbox" ADD CONSTRAINT "mailSyncOutbox_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncOutbox" ADD CONSTRAINT "mailSyncOutbox_XZ1v8tq0YcLW_fkey" FOREIGN KEY ("mailboxId","sequence") REFERENCES "mailSyncChange"("mailboxId","sequence") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncProviderState" ADD CONSTRAINT "mailSyncProviderState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSyncStream" ADD CONSTRAINT "mailSyncStream_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;