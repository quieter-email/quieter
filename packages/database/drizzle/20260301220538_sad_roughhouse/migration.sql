CREATE TABLE "gmailMailboxState" (
	"userId" text PRIMARY KEY,
	"lastSyncAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmailMessageCache" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"messageId" text NOT NULL,
	"threadId" text NOT NULL,
	"snippet" text,
	"subject" text,
	"from" text,
	"date" text,
	"internalDateMs" bigint,
	"senderAvatarUrl" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmailMessageCache_userId_messageId_unique" UNIQUE("userId","messageId")
);
--> statement-breakpoint
ALTER TABLE "gmailMailboxState" ADD CONSTRAINT "gmailMailboxState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "gmailMessageCache" ADD CONSTRAINT "gmailMessageCache_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");