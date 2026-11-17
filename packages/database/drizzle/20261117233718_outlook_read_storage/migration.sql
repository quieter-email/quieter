-- quieter:contract
CREATE TABLE "outlookCredential" (
	"accessTokenExpiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"encryptedAccessToken" text,
	"encryptedRefreshToken" text,
	"generation" integer DEFAULT 0 NOT NULL,
	"graphAccountId" text NOT NULL,
	"issuer" text NOT NULL,
	"mailboxId" text PRIMARY KEY,
	"ownerUserId" text NOT NULL,
	"scopes" text NOT NULL,
	"status" text NOT NULL,
	"subject" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "outlook_credential_owner_subject_unique" UNIQUE("ownerUserId","issuer","subject"),
	CONSTRAINT "outlook_credential_generation_check" CHECK ("generation" >= 0),
	CONSTRAINT "outlook_credential_status_check" CHECK ("status" in ('connected', 'needs_reconnect', 'disconnected'))
);
--> statement-breakpoint
CREATE TABLE "outlookFolder" (
	"checkpointVersion" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"displayName" text NOT NULL,
	"encryptedDeltaLink" text,
	"encryptedNextLink" text,
	"folderId" text,
	"isHidden" boolean DEFAULT false NOT NULL,
	"lastCompletedAt" timestamp with time zone,
	"lastDiscoveredAt" timestamp with time zone,
	"lastErrorCode" text,
	"leaseExpiresAt" timestamp with time zone,
	"leaseId" text,
	"mailboxId" text,
	"parentFolderId" text,
	"role" text,
	"state" text DEFAULT 'pending' NOT NULL,
	"syncEpoch" integer DEFAULT 0 NOT NULL,
	"totalItemCount" integer DEFAULT 0 NOT NULL,
	"unreadItemCount" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "outlookFolder_pkey" PRIMARY KEY("mailboxId","folderId"),
	CONSTRAINT "outlook_folder_counters_check" CHECK ("syncEpoch" >= 0 and "checkpointVersion" >= 0 and "totalItemCount" >= 0 and "unreadItemCount" >= 0),
	CONSTRAINT "outlook_folder_role_check" CHECK ("role" is null or "role" in ('inbox', 'sent', 'drafts', 'spam', 'trash', 'archive')),
	CONSTRAINT "outlook_folder_state_check" CHECK ("state" in ('pending', 'hydrating', 'ready', 'reconcile', 'error')),
	CONSTRAINT "outlook_folder_lease_check" CHECK (("leaseId" is null) = ("leaseExpiresAt" is null))
);
--> statement-breakpoint
CREATE TABLE "outlookMessage" (
	"changeKey" text NOT NULL,
	"contentState" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"deletedAt" timestamp with time zone,
	"isDraft" boolean NOT NULL,
	"isRead" boolean NOT NULL,
	"mailboxId" text,
	"messageId" text,
	"projection" jsonb NOT NULL,
	"receivedAt" timestamp with time zone NOT NULL,
	"sentAt" timestamp with time zone,
	"threadId" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "outlookMessage_pkey" PRIMARY KEY("mailboxId","messageId"),
	CONSTRAINT "outlook_message_content_state_check" CHECK ("contentState" in ('metadata', 'full', 'truncated')),
	CONSTRAINT "outlook_message_projection_check" CHECK (jsonb_typeof("projection") = 'object')
);
--> statement-breakpoint
CREATE TABLE "outlookMessageFolder" (
	"createdAt" timestamp with time zone NOT NULL,
	"folderId" text,
	"mailboxId" text,
	"messageId" text,
	"seenEpoch" integer NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "outlookMessageFolder_pkey" PRIMARY KEY("mailboxId","folderId","messageId"),
	CONSTRAINT "outlook_message_folder_epoch_check" CHECK ("seenEpoch" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outlookOAuthState" (
	"claimId" text,
	"consumedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"credentialGeneration" integer,
	"encryptedCodeVerifier" text NOT NULL,
	"encryptedNonce" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"mailboxId" text,
	"organizationId" text NOT NULL,
	"redirectUri" text NOT NULL,
	"requestedScopes" text NOT NULL,
	"returnTo" text NOT NULL,
	"sessionHash" text NOT NULL,
	"stateHash" text PRIMARY KEY,
	"userId" text NOT NULL,
	CONSTRAINT "outlook_oauth_state_reconnect_check" CHECK (("mailboxId" is null and "credentialGeneration" is null) or ("mailboxId" is not null and "credentialGeneration" is not null and "credentialGeneration" >= 0)),
	CONSTRAINT "outlook_oauth_state_claim_check" CHECK (("claimId" is null) = ("consumedAt" is null))
);
--> statement-breakpoint
CREATE TABLE "outlookReadCursor" (
	"createdAt" timestamp with time zone NOT NULL,
	"credentialGeneration" integer NOT NULL,
	"encryptedState" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"ownerUserId" text NOT NULL,
	"queryHash" text NOT NULL,
	CONSTRAINT "outlook_read_cursor_generation_check" CHECK ("credentialGeneration" >= 0)
);
--> statement-breakpoint
CREATE TABLE "outlookSyncState" (
	"activeParentFolderId" text,
	"checkpointVersion" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"discoveryStartedAt" timestamp with time zone,
	"encryptedFolderPageUrl" text,
	"folderDiscoveryCompletedAt" timestamp with time zone,
	"folderQueue" jsonb DEFAULT '[]' NOT NULL,
	"generation" integer NOT NULL,
	"leaseExpiresAt" timestamp with time zone,
	"leaseId" text,
	"mailboxId" text PRIMARY KEY,
	"state" text NOT NULL,
	"systemFolders" jsonb NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "outlook_sync_state_generation_check" CHECK ("generation" >= 0 and "checkpointVersion" >= 0),
	CONSTRAINT "outlook_sync_state_state_check" CHECK ("state" in ('discovering', 'ready')),
	CONSTRAINT "outlook_sync_state_folders_check" CHECK (jsonb_typeof("systemFolders") = 'object' and jsonb_typeof("folderQueue") = 'array'),
	CONSTRAINT "outlook_sync_state_lease_check" CHECK (("leaseId" is null) = ("leaseExpiresAt" is null))
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_id_owner_user_id_unique" UNIQUE("id","ownerUserId");--> statement-breakpoint
CREATE INDEX "outlook_folder_work_idx" ON "outlookFolder" ("mailboxId","state","updatedAt");--> statement-breakpoint
CREATE INDEX "outlook_message_thread_idx" ON "outlookMessage" ("mailboxId","threadId","receivedAt");--> statement-breakpoint
CREATE INDEX "outlook_message_unread_idx" ON "outlookMessage" ("mailboxId","isRead","receivedAt");--> statement-breakpoint
CREATE INDEX "outlook_message_folder_message_idx" ON "outlookMessageFolder" ("mailboxId","messageId");--> statement-breakpoint
CREATE INDEX "outlook_oauth_state_expiry_idx" ON "outlookOAuthState" ("expiresAt");--> statement-breakpoint
CREATE INDEX "outlook_oauth_state_user_idx" ON "outlookOAuthState" ("userId");--> statement-breakpoint
CREATE INDEX "outlook_oauth_state_organization_idx" ON "outlookOAuthState" ("organizationId");--> statement-breakpoint
CREATE INDEX "outlook_oauth_state_mailbox_owner_idx" ON "outlookOAuthState" ("mailboxId","userId");--> statement-breakpoint
CREATE INDEX "outlook_read_cursor_expiry_idx" ON "outlookReadCursor" ("expiresAt");--> statement-breakpoint
CREATE INDEX "outlook_read_cursor_mailbox_idx" ON "outlookReadCursor" ("mailboxId");--> statement-breakpoint
ALTER TABLE "outlookCredential" ADD CONSTRAINT "outlookCredential_ownerUserId_user_id_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookCredential" ADD CONSTRAINT "outlook_credential_mailbox_owner_fk" FOREIGN KEY ("mailboxId","ownerUserId") REFERENCES "mailbox"("id","ownerUserId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookFolder" ADD CONSTRAINT "outlookFolder_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookMessage" ADD CONSTRAINT "outlookMessage_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookMessageFolder" ADD CONSTRAINT "outlook_message_folder_folder_fk" FOREIGN KEY ("mailboxId","folderId") REFERENCES "outlookFolder"("mailboxId","folderId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookMessageFolder" ADD CONSTRAINT "outlook_message_folder_message_fk" FOREIGN KEY ("mailboxId","messageId") REFERENCES "outlookMessage"("mailboxId","messageId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookOAuthState" ADD CONSTRAINT "outlookOAuthState_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookOAuthState" ADD CONSTRAINT "outlookOAuthState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookOAuthState" ADD CONSTRAINT "outlook_oauth_state_mailbox_owner_fk" FOREIGN KEY ("mailboxId","userId") REFERENCES "mailbox"("id","ownerUserId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookReadCursor" ADD CONSTRAINT "outlookReadCursor_ownerUserId_user_id_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookReadCursor" ADD CONSTRAINT "outlook_read_cursor_mailbox_owner_fk" FOREIGN KEY ("mailboxId","ownerUserId") REFERENCES "mailbox"("id","ownerUserId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "outlookSyncState" ADD CONSTRAINT "outlookSyncState_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailbox" DROP CONSTRAINT "mailbox_provider_ownership_check", ADD CONSTRAINT "mailbox_provider_ownership_check" CHECK ((
        ("provider" = 'gmail' and "ownerUserId" is not null and "managedOwnerUserId" is null)
        or
        ("provider" = 'outlook' and "ownerUserId" is not null and "accessMode" = 'private' and "managedOwnerUserId" is null and "divisionId" is null)
        or
        ("provider" = 'managed' and "accessMode" = 'private' and "ownerUserId" is null and "managedOwnerUserId" is not null and "organizationId" is not null)
        or
        ("provider" = 'managed' and "accessMode" = 'shared' and "ownerUserId" is null and "managedOwnerUserId" is null and "organizationId" is not null)
      ));--> statement-breakpoint
ALTER TABLE "mailbox" DROP CONSTRAINT "mailbox_provider_check", ADD CONSTRAINT "mailbox_provider_check" CHECK ("provider" in ('gmail', 'managed', 'outlook'));