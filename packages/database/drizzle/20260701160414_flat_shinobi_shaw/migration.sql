CREATE TABLE "connectorCredential" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"providerAccountId" text NOT NULL,
	"accountEmail" text,
	"displayName" text,
	"encryptedAccessToken" text,
	"encryptedRefreshToken" text,
	"accessTokenExpiresAt" timestamp,
	"scopes" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "connector_credential_user_provider_unique" UNIQUE("userId","provider"),
	CONSTRAINT "connector_credential_provider_check" CHECK ("provider" in ('google_calendar')),
	CONSTRAINT "connector_credential_status_check" CHECK ("status" in ('connected', 'needs_reconnect'))
);
--> statement-breakpoint
CREATE TABLE "connectorOAuthState" (
	"id" text PRIMARY KEY,
	"userId" text NOT NULL,
	"provider" text NOT NULL,
	"codeVerifier" text NOT NULL,
	"returnTo" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "connector_oauth_state_provider_check" CHECK ("provider" in ('google_calendar'))
);
--> statement-breakpoint
CREATE INDEX "connector_credential_user_id_idx" ON "connectorCredential" ("userId");--> statement-breakpoint
CREATE INDEX "connector_oauth_state_user_id_idx" ON "connectorOAuthState" ("userId");--> statement-breakpoint
CREATE INDEX "connector_oauth_state_expires_at_idx" ON "connectorOAuthState" ("expiresAt");--> statement-breakpoint
ALTER TABLE "connectorCredential" ADD CONSTRAINT "connectorCredential_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "connectorOAuthState" ADD CONSTRAINT "connectorOAuthState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;