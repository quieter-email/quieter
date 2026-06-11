CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" text NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"password" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "account_providerId_accountId_unique" UNIQUE("providerId","accountId")
);
--> statement-breakpoint
CREATE TABLE "apikey" (
	"id" text PRIMARY KEY,
	"configId" text DEFAULT 'default' NOT NULL,
	"name" text,
	"start" text,
	"prefix" text,
	"key" text NOT NULL,
	"referenceId" text NOT NULL,
	"refillInterval" integer,
	"refillAmount" integer,
	"lastRefillAt" timestamp,
	"enabled" boolean DEFAULT true,
	"rateLimitEnabled" boolean DEFAULT true,
	"rateLimitTimeWindow" integer,
	"rateLimitMax" integer,
	"requestCount" integer DEFAULT 0,
	"remaining" integer,
	"lastRequest" timestamp,
	"expiresAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"permissions" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "billingSubscription" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"providerSubscriptionId" text NOT NULL,
	"providerCustomerId" text,
	"providerProductId" text NOT NULL,
	"plan" text NOT NULL,
	"status" text NOT NULL,
	"currentPeriodStart" timestamp NOT NULL,
	"currentPeriodEnd" timestamp NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "billing_subscription_provider_subscription_unique" UNIQUE("provider","providerSubscriptionId")
);
--> statement-breakpoint
CREATE TABLE "chat" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"userId" text NOT NULL,
	"title" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "chat_id_user_id_unique" UNIQUE("id","userId"),
	CONSTRAINT "chat_id_mailbox_id_user_id_unique" UNIQUE("id","mailboxId","userId")
);
--> statement-breakpoint
CREATE TABLE "chatMessage" (
	"id" text PRIMARY KEY,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"parts" jsonb NOT NULL,
	"status" text DEFAULT 'complete' NOT NULL,
	"error" text,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "chat_message_id_chat_id_unique" UNIQUE("id","chatId"),
	CONSTRAINT "chat_message_chat_id_position_unique" UNIQUE("chatId","position")
);
--> statement-breakpoint
CREATE TABLE "chatRun" (
	"id" text PRIMARY KEY,
	"chatId" text NOT NULL,
	"userId" text NOT NULL,
	"assistantMessageId" text NOT NULL,
	"status" text NOT NULL,
	"mailboxId" text NOT NULL,
	"mailboxCategory" text NOT NULL,
	"cancelRequestedAt" timestamp,
	"lastHeartbeatAt" timestamp,
	"error" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmailCredential" (
	"mailboxId" text PRIMARY KEY,
	"googleSubject" text NOT NULL CONSTRAINT "gmail_credential_google_subject_unique" UNIQUE,
	"encryptedAccessToken" text,
	"encryptedRefreshToken" text,
	"accessTokenExpiresAt" timestamp,
	"scopes" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gmailOAuthState" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"mailboxId" text,
	"organizationId" text,
	"codeVerifier" text NOT NULL,
	"returnTo" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"inviterId" text NOT NULL,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailDomain" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"domain" text NOT NULL CONSTRAINT "mail_domain_domain_unique" UNIQUE,
	"mailFromDomain" text NOT NULL,
	"status" text NOT NULL,
	"requiredDnsRecords" jsonb NOT NULL,
	"lastCheckResult" jsonb,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"verifiedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" text PRIMARY KEY,
	"provider" text NOT NULL,
	"emailAddress" text NOT NULL CONSTRAINT "mailbox_email_address_unique" UNIQUE,
	"displayName" text,
	"ownerUserId" text,
	"organizationId" text,
	"status" text DEFAULT 'connected' NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_provider_ownership_check" CHECK ((
        ("provider" = 'gmail' and "ownerUserId" is not null)
        or
        ("provider" = 'managed' and "ownerUserId" is null and "organizationId" is not null)
      )),
	CONSTRAINT "mailbox_provider_check" CHECK ("provider" in ('gmail', 'managed')),
	CONSTRAINT "mailbox_status_check" CHECK ("status" in ('connected', 'needs_reconnect'))
);
--> statement-breakpoint
CREATE TABLE "mailboxGrant" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_grant_mailbox_id_user_id_unique" UNIQUE("mailboxId","userId"),
	CONSTRAINT "mailbox_grant_role_check" CHECK ("role" in ('reader', 'responder', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "managedMailMessage" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"direction" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"threadId" text NOT NULL,
	"messageHeaderId" text,
	"inReplyTo" text,
	"references" text,
	"from" text NOT NULL,
	"to" text,
	"cc" text,
	"bcc" text,
	"replyTo" text,
	"subject" text,
	"snippet" text,
	"bodyHtml" text,
	"bodyText" text,
	"headers" jsonb DEFAULT '[]' NOT NULL,
	"isRead" boolean DEFAULT false NOT NULL,
	"sentAt" timestamp NOT NULL,
	"s3Bucket" text,
	"s3Key" text,
	"rawSizeBytes" integer,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "managed_mail_message_mailbox_provider_message_unique" UNIQUE("mailboxId","providerMessageId"),
	CONSTRAINT "managed_mail_message_direction_check" CHECK ("direction" in ('inbound', 'outbound'))
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "member_organization_id_user_id_unique" UNIQUE("organizationId","userId")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL CONSTRAINT "organization_slug_unique" UNIQUE,
	"logo" text,
	"metadata" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "organizationMailUsageAlertEvent" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"periodStart" timestamp NOT NULL,
	"periodEnd" timestamp NOT NULL,
	"target" text NOT NULL,
	"milestonePercent" integer NOT NULL,
	"thresholdMicroCents" bigint NOT NULL,
	"usageMicroCents" bigint NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "organization_mail_usage_alert_event_period_milestone_unique" UNIQUE("organizationId","periodStart","target","milestonePercent")
);
--> statement-breakpoint
CREATE TABLE "organizationMailUsageEvent" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"direction" text NOT NULL,
	"provider" text NOT NULL,
	"providerMessageId" text NOT NULL,
	"dedupeKey" text NOT NULL CONSTRAINT "organization_mail_usage_event_dedupe_key_unique" UNIQUE,
	"recipientCount" integer NOT NULL,
	"messageCount" integer NOT NULL,
	"messageSizeBytes" integer NOT NULL,
	"attachmentSizeBytes" integer NOT NULL,
	"incomingChunkCount" integer NOT NULL,
	"sesCostMicroCents" bigint NOT NULL,
	"includedSesCostMicroCents" bigint NOT NULL,
	"billableCostMicroCents" bigint NOT NULL,
	"polarEventReportedAt" timestamp,
	"metadata" jsonb,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizationMailUsageSettings" (
	"organizationId" text PRIMARY KEY,
	"overageEnabled" boolean DEFAULT true NOT NULL,
	"monthlyOverageLimitMicroCents" bigint,
	"alertMilestonePercents" jsonb DEFAULT '[50,80,100]' NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL CONSTRAINT "passkey_credential_id_unique" UNIQUE,
	"counter" bigint NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expiresAt" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"activeOrganizationId" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"defaultMailboxId" text,
	"mailboxSwitcherOrder" jsonb,
	"termsAcceptedAt" timestamp,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "waitlistSignup" (
	"email" text PRIMARY KEY,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "apikey_config_id_idx" ON "apikey" ("configId");--> statement-breakpoint
CREATE INDEX "apikey_reference_id_idx" ON "apikey" ("referenceId");--> statement-breakpoint
CREATE INDEX "apikey_key_idx" ON "apikey" ("key");--> statement-breakpoint
CREATE INDEX "billing_subscription_user_id_idx" ON "billingSubscription" ("userId");--> statement-breakpoint
CREATE INDEX "billing_subscription_provider_subscription_id_idx" ON "billingSubscription" ("providerSubscriptionId");--> statement-breakpoint
CREATE INDEX "chat_mailbox_id_user_id_updated_at_idx" ON "chat" ("mailboxId","userId","updatedAt");--> statement-breakpoint
CREATE INDEX "chat_run_chat_id_status_idx" ON "chatRun" ("chatId","status");--> statement-breakpoint
CREATE UNIQUE INDEX "chat_run_one_active_per_chat" ON "chatRun" ("chatId") WHERE "status" in ('queued', 'running', 'waiting_on_tool');--> statement-breakpoint
CREATE INDEX "gmail_oauth_state_user_id_idx" ON "gmailOAuthState" ("userId");--> statement-breakpoint
CREATE INDEX "gmail_oauth_state_expires_at_idx" ON "gmailOAuthState" ("expiresAt");--> statement-breakpoint
CREATE INDEX "invitation_organization_id_idx" ON "invitation" ("organizationId");--> statement-breakpoint
CREATE INDEX "invitation_email_idx" ON "invitation" ("email");--> statement-breakpoint
CREATE INDEX "mail_domain_organization_id_idx" ON "mailDomain" ("organizationId");--> statement-breakpoint
CREATE INDEX "mailbox_owner_user_id_idx" ON "mailbox" ("ownerUserId");--> statement-breakpoint
CREATE INDEX "mailbox_organization_id_idx" ON "mailbox" ("organizationId");--> statement-breakpoint
CREATE INDEX "mailbox_grant_mailbox_id_idx" ON "mailboxGrant" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mailbox_grant_user_id_idx" ON "mailboxGrant" ("userId");--> statement-breakpoint
CREATE INDEX "managed_mail_message_mailbox_direction_sent_at_idx" ON "managedMailMessage" ("mailboxId","direction","sentAt");--> statement-breakpoint
CREATE INDEX "managed_mail_message_mailbox_thread_id_idx" ON "managedMailMessage" ("mailboxId","threadId");--> statement-breakpoint
CREATE INDEX "managed_mail_message_s3_bucket_key_idx" ON "managedMailMessage" ("s3Bucket","s3Key");--> statement-breakpoint
CREATE INDEX "member_organization_id_idx" ON "member" ("organizationId");--> statement-breakpoint
CREATE INDEX "member_user_id_idx" ON "member" ("userId");--> statement-breakpoint
CREATE INDEX "organization_mail_usage_alert_event_organization_period_idx" ON "organizationMailUsageAlertEvent" ("organizationId","periodStart");--> statement-breakpoint
CREATE INDEX "organization_mail_usage_event_organization_created_at_idx" ON "organizationMailUsageEvent" ("organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "passkey_user_id_idx" ON "passkey" ("userId");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "billingSubscription" ADD CONSTRAINT "billingSubscription_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "chatMessage" ADD CONSTRAINT "chat_message_chat_id_user_id_fkey" FOREIGN KEY ("chatId","userId") REFERENCES "chat"("id","userId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chatRun" ADD CONSTRAINT "chat_run_assistant_message_id_chat_id_fkey" FOREIGN KEY ("assistantMessageId","chatId") REFERENCES "chatMessage"("id","chatId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chatRun" ADD CONSTRAINT "chat_run_chat_id_mailbox_id_user_id_fkey" FOREIGN KEY ("chatId","mailboxId","userId") REFERENCES "chat"("id","mailboxId","userId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailCredential" ADD CONSTRAINT "gmailCredential_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailOAuthState" ADD CONSTRAINT "gmailOAuthState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailOAuthState" ADD CONSTRAINT "gmailOAuthState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "gmailOAuthState" ADD CONSTRAINT "gmailOAuthState_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "mailDomain" ADD CONSTRAINT "mailDomain_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_ownerUserId_user_id_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "mailboxGrant" ADD CONSTRAINT "mailboxGrant_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxGrant" ADD CONSTRAINT "mailboxGrant_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managedMailMessage" ADD CONSTRAINT "managedMailMessage_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "organizationMailUsageAlertEvent" ADD CONSTRAINT "organizationMailUsageAlertEvent_ROF4Zd0q45Cy_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "organizationMailUsageEvent" ADD CONSTRAINT "organizationMailUsageEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "organizationMailUsageSettings" ADD CONSTRAINT "organizationMailUsageSettings_HFx0SA0zm7qR_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_activeOrganizationId_organization_id_fkey" FOREIGN KEY ("activeOrganizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");