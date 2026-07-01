CREATE TABLE "organizationApiMailAttachment" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"messageId" text NOT NULL,
	"fileName" text NOT NULL,
	"normalizedFileName" text DEFAULT '' NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"inline" boolean DEFAULT false NOT NULL,
	"contentId" text,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizationApiMailMessage" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"messageHeaderId" text,
	"from" text NOT NULL,
	"fromNormalized" text DEFAULT '' NOT NULL,
	"senderAddress" text NOT NULL,
	"to" text,
	"toNormalized" text DEFAULT '' NOT NULL,
	"cc" text,
	"ccNormalized" text DEFAULT '' NOT NULL,
	"bcc" text,
	"bccNormalized" text DEFAULT '' NOT NULL,
	"replyTo" text,
	"subject" text,
	"snippet" text,
	"bodyHtml" text,
	"bodyText" text,
	"searchText" text DEFAULT '' NOT NULL,
	"headers" jsonb DEFAULT '[]' NOT NULL,
	"rawSizeBytes" integer,
	"sentAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_api_mail_message_org_provider_unique" UNIQUE("organizationId","providerMessageId")
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "includeApiSentMessages" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_api_mail_attachment_org_name_idx" ON "organizationApiMailAttachment" ("organizationId","normalizedFileName");--> statement-breakpoint
CREATE INDEX "organization_api_mail_attachment_message_idx" ON "organizationApiMailAttachment" ("messageId");--> statement-breakpoint
CREATE INDEX "organization_api_mail_message_org_sent_at_idx" ON "organizationApiMailMessage" ("organizationId","sentAt","id");--> statement-breakpoint
CREATE INDEX "organization_api_mail_message_org_sender_idx" ON "organizationApiMailMessage" ("organizationId","senderAddress");--> statement-breakpoint
ALTER TABLE "organizationApiMailAttachment" ADD CONSTRAINT "organizationApiMailAttachment_1RhXbTveCg1M_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationApiMailAttachment" ADD CONSTRAINT "organizationApiMailAttachment_pdgJFqrAK1JS_fkey" FOREIGN KEY ("messageId") REFERENCES "organizationApiMailMessage"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationApiMailMessage" ADD CONSTRAINT "organizationApiMailMessage_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;