CREATE TABLE "mailSnooze" (
	"actorUserId" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"code" text,
	"createdAt" timestamp with time zone NOT NULL,
	"hiddenMessageIds" jsonb NOT NULL,
	"hideOperationId" text,
	"hideRequestId" text NOT NULL,
	"id" text PRIMARY KEY,
	"knownIncomingMessageIds" jsonb NOT NULL,
	"leaseToken" text,
	"leaseUntil" timestamp with time zone,
	"mailboxId" text NOT NULL,
	"message" text,
	"nextWakeAt" timestamp with time zone,
	"returnAt" timestamp with time zone NOT NULL,
	"returnOperationId" text,
	"returnRequestId" text,
	"status" text NOT NULL,
	"threadId" text NOT NULL,
	"timeZone" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"version" integer NOT NULL,
	CONSTRAINT "mail_snooze_mailbox_thread_unique" UNIQUE("mailboxId","threadId"),
	CONSTRAINT "mail_snooze_version_check" CHECK ("version" >= 0),
	CONSTRAINT "mail_snooze_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "mail_snooze_lease_pair_check" CHECK (("leaseToken" is null) = ("leaseUntil" is null)),
	CONSTRAINT "mail_snooze_status_check" CHECK ("status" in ('preparing', 'active', 'returning', 'returned', 'cancelled', 'superseded', 'suspended', 'failed', 'uncertain'))
);
--> statement-breakpoint
CREATE TABLE "mailSnoozeOperation" (
	"actorUserId" text NOT NULL,
	"code" text,
	"createdAt" timestamp with time zone NOT NULL,
	"expectedVersion" integer,
	"id" text PRIMARY KEY,
	"kind" text NOT NULL,
	"mailboxId" text NOT NULL,
	"message" text,
	"requestHash" text NOT NULL,
	"requestId" text NOT NULL,
	"resultingVersion" integer,
	"snoozeId" text,
	"status" text NOT NULL,
	"threadId" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "mail_snooze_operation_request_unique" UNIQUE("actorUserId","mailboxId","requestId","threadId"),
	CONSTRAINT "mail_snooze_operation_expected_version_check" CHECK ("expectedVersion" is null or "expectedVersion" >= 0),
	CONSTRAINT "mail_snooze_operation_resulting_version_check" CHECK ("resultingVersion" is null or "resultingVersion" >= 0),
	CONSTRAINT "mail_snooze_operation_kind_check" CHECK ("kind" in ('snooze', 'reschedule', 'cancel', 'return-now')),
	CONSTRAINT "mail_snooze_operation_status_check" CHECK ("status" in ('pending', 'applied', 'failed', 'uncertain', 'superseded'))
);
--> statement-breakpoint
CREATE INDEX "mail_snooze_next_wake_idx" ON "mailSnooze" ("nextWakeAt") WHERE "nextWakeAt" is not null;--> statement-breakpoint
CREATE INDEX "mail_snooze_mailbox_status_return_idx" ON "mailSnooze" ("mailboxId","status","returnAt","id");--> statement-breakpoint
CREATE INDEX "mail_snooze_operation_mailbox_idx" ON "mailSnoozeOperation" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mail_snooze_operation_snooze_status_idx" ON "mailSnoozeOperation" ("snoozeId","status");--> statement-breakpoint
ALTER TABLE "mailSnooze" ADD CONSTRAINT "mailSnooze_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailSnooze" ADD CONSTRAINT "mailSnooze_hideOperationId_mailPlacementOperation_id_fkey" FOREIGN KEY ("hideOperationId") REFERENCES "mailPlacementOperation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailSnooze" ADD CONSTRAINT "mailSnooze_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSnooze" ADD CONSTRAINT "mailSnooze_returnOperationId_mailPlacementOperation_id_fkey" FOREIGN KEY ("returnOperationId") REFERENCES "mailPlacementOperation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailSnoozeOperation" ADD CONSTRAINT "mailSnoozeOperation_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSnoozeOperation" ADD CONSTRAINT "mailSnoozeOperation_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailSnoozeOperation" ADD CONSTRAINT "mailSnoozeOperation_snoozeId_mailSnooze_id_fkey" FOREIGN KEY ("snoozeId") REFERENCES "mailSnooze"("id") ON DELETE SET NULL;