CREATE TABLE "semanticEmbedding" (
	"sourceKey" text,
	"model" text,
	"chunkIndex" integer,
	"sourceRevision" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"createdAt" timestamp NOT NULL,
	"memoryId" text,
	"chatMessageId" text,
	"gmailMailboxId" text,
	"gmailMessageId" text,
	"managedMessageId" text,
	CONSTRAINT "semanticEmbedding_pkey" PRIMARY KEY("sourceKey","model","chunkIndex"),
	CONSTRAINT "semantic_embedding_source_check" CHECK (num_nonnulls("memoryId", "chatMessageId", "gmailMessageId", "managedMessageId") = 1 and (("gmailMailboxId" is null) = ("gmailMessageId" is null))),
	CONSTRAINT "semantic_embedding_chunk_check" CHECK ("chunkIndex" >= 0)
);
--> statement-breakpoint
CREATE TABLE "semanticSearchLease" (
	"userId" text,
	"mailboxId" text,
	"token" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	CONSTRAINT "semanticSearchLease_pkey" PRIMARY KEY("userId","mailboxId")
);
--> statement-breakpoint
CREATE INDEX "semantic_embedding_memory_idx" ON "semanticEmbedding" ("memoryId");--> statement-breakpoint
CREATE INDEX "semantic_embedding_chat_idx" ON "semanticEmbedding" ("chatMessageId");--> statement-breakpoint
CREATE INDEX "semantic_embedding_gmail_idx" ON "semanticEmbedding" ("gmailMailboxId","gmailMessageId");--> statement-breakpoint
CREATE INDEX "semantic_embedding_managed_idx" ON "semanticEmbedding" ("managedMessageId");--> statement-breakpoint
ALTER TABLE "semanticEmbedding" ADD CONSTRAINT "semanticEmbedding_memoryId_aiMemory_id_fkey" FOREIGN KEY ("memoryId") REFERENCES "aiMemory"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticEmbedding" ADD CONSTRAINT "semanticEmbedding_chatMessageId_chatMessage_id_fkey" FOREIGN KEY ("chatMessageId") REFERENCES "chatMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticEmbedding" ADD CONSTRAINT "semanticEmbedding_managedMessageId_managedMailMessage_id_fkey" FOREIGN KEY ("managedMessageId") REFERENCES "managedMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticEmbedding" ADD CONSTRAINT "semantic_embedding_gmail_source_fkey" FOREIGN KEY ("gmailMailboxId","gmailMessageId") REFERENCES "gmailCapturedMessage"("mailboxId","messageId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticSearchLease" ADD CONSTRAINT "semanticSearchLease_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "semanticSearchLease" ADD CONSTRAINT "semanticSearchLease_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;