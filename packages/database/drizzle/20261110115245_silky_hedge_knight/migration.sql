CREATE TABLE "scheduledMailSendAbandonment" (
	"createdAt" timestamp with time zone NOT NULL,
	"mailboxId" text,
	"sendOperationId" text,
	"userId" text,
	CONSTRAINT "scheduledMailSendAbandonment_pkey" PRIMARY KEY("mailboxId","userId","sendOperationId")
);
--> statement-breakpoint
ALTER TABLE "scheduledMailSendAbandonment" ADD CONSTRAINT "scheduledMailSendAbandonment_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "scheduledMailSendAbandonment" ADD CONSTRAINT "scheduledMailSendAbandonment_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;