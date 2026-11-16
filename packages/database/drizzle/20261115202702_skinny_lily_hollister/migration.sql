CREATE TABLE "mailboxAiAuthority" (
	"automationPaused" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"mailboxId" text PRIMARY KEY,
	"readOnly" boolean DEFAULT false NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"updatedByUserId" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mailbox_ai_authority_version_check" CHECK ("version" >= 0)
);
--> statement-breakpoint
ALTER TABLE "mailboxAiAuthority" ADD CONSTRAINT "mailboxAiAuthority_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxAiAuthority" ADD CONSTRAINT "mailboxAiAuthority_updatedByUserId_user_id_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "user"("id") ON DELETE SET NULL;