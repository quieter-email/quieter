ALTER TABLE "gmailUsefulDetail" ADD COLUMN "eventAt" timestamp;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD COLUMN "relevantFrom" timestamp;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD COLUMN "relevanceSource" text;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD COLUMN "reference" text;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD COLUMN "location" text;--> statement-breakpoint
UPDATE "gmailUsefulDetail"
SET "relevantFrom" = "receivedAt", "relevanceSource" = 'inferred';--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ALTER COLUMN "relevantFrom" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ALTER COLUMN "relevanceSource" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" ADD CONSTRAINT "gmail_useful_detail_relevance_source_check" CHECK ("relevanceSource" in ('explicit', 'inferred'));--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" DROP CONSTRAINT "gmail_useful_detail_kind_check", ADD CONSTRAINT "gmail_useful_detail_kind_check" CHECK ("kind" in ('application', 'appointment', 'bill', 'delivery', 'document_expiry', 'reservation', 'return', 'security_alert', 'task', 'travel', 'verification_code'));--> statement-breakpoint
ALTER TABLE "gmailUsefulDetail" DROP CONSTRAINT "gmail_useful_detail_payload_check", ADD CONSTRAINT "gmail_useful_detail_payload_check" CHECK ((
        ("kind" = 'verification_code' and "encryptedCode" is not null and "deliveryStatus" is null)
        or
        ("kind" = 'delivery' and "encryptedCode" is null and "deliveryStatus" is not null)
        or
        ("kind" not in ('delivery', 'verification_code') and "encryptedCode" is null and "deliveryStatus" is null)
      ));
