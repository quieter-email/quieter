CREATE TABLE "gmailUsefulDetail" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"kind" text NOT NULL,
	"dedupeKey" text NOT NULL,
	"gmailMessageId" text NOT NULL,
	"gmailThreadId" text,
	"title" text NOT NULL,
	"summary" text,
	"encryptedCode" text,
	"carrier" text,
	"trackingNumber" text,
	"deliveryStatus" text,
	"expectedAt" timestamp,
	"receivedAt" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"dismissedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_useful_detail_mailbox_kind_dedupe_unique" UNIQUE("mailboxId","kind","dedupeKey"),
	CONSTRAINT "gmail_useful_detail_kind_check" CHECK ("kind" in ('delivery', 'verification_code')),
	CONSTRAINT "gmail_useful_detail_delivery_status_check" CHECK ("deliveryStatus" is null or "deliveryStatus" in ('delayed', 'delivered', 'in_transit', 'ordered', 'out_for_delivery', 'ready_for_pickup', 'shipped', 'unknown')),
	CONSTRAINT "gmail_useful_detail_payload_check" CHECK ((
        ("kind" = 'verification_code' and "encryptedCode" is not null and "deliveryStatus" is null)
        or
        ("kind" = 'delivery' and "encryptedCode" is null and "deliveryStatus" is not null)
      ))
);
--> statement-breakpoint
CREATE TABLE "gmailUsefulDetailEvent" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"gmailMessageId" text NOT NULL,
	"model" text,
	"promptTokens" integer,
	"completionTokens" integer,
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp,
	"processedAt" timestamp,
	"usageReportedAt" timestamp,
	"lastError" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmail_useful_detail_event_mailbox_message_unique" UNIQUE("mailboxId","gmailMessageId")
);
--> statement-breakpoint
CREATE TABLE "gmailUsefulDetailSettings" (
	"mailboxId" text PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "gmail_useful_detail_mailbox_active_idx" ON "gmailUsefulDetail" ("mailboxId","dismissedAt","expiresAt");--> statement-breakpoint
CREATE INDEX "gmail_useful_detail_event_mailbox_created_at_idx" ON "gmailUsefulDetailEvent" ("mailboxId","createdAt");--> statement-breakpoint
CREATE INDEX "gmail_useful_detail_event_mailbox_retry_idx" ON "gmailUsefulDetailEvent" ("mailboxId","processedAt","nextAttemptAt");--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD CONSTRAINT "gmailUsefulDetail_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailEvent" ADD CONSTRAINT "gmailUsefulDetailEvent_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetailSettings" ADD CONSTRAINT "gmailUsefulDetailSettings_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;