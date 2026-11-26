CREATE TABLE "oauthAccessToken" (
	"authorizationCodeId" text,
	"clientId" text NOT NULL,
	"confirmation" jsonb,
	"createdAt" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"referenceId" text,
	"refreshId" text,
	"requestedUserInfoClaims" jsonb,
	"resources" jsonb,
	"revoked" timestamp,
	"scopes" jsonb NOT NULL,
	"sessionId" text,
	"token" text NOT NULL UNIQUE,
	"userId" text
);
--> statement-breakpoint
CREATE TABLE "oauthClient" (
	"applicationType" text,
	"backchannelLogoutSessionRequired" boolean,
	"backchannelLogoutUri" text,
	"clientCredentialsScopes" jsonb,
	"clientDiscoveryId" text,
	"clientId" text NOT NULL UNIQUE,
	"clientSecret" text,
	"contacts" jsonb,
	"createdAt" timestamp,
	"disabled" boolean DEFAULT false,
	"dpopBoundAccessTokens" boolean DEFAULT false,
	"enableEndSession" boolean,
	"grantTypes" jsonb,
	"icon" text,
	"id" text PRIMARY KEY,
	"jwks" text,
	"jwksUri" text,
	"metadata" jsonb,
	"name" text,
	"policy" text,
	"postLogoutRedirectUris" jsonb,
	"redirectUris" jsonb NOT NULL,
	"referenceId" text,
	"requirePKCE" boolean,
	"responseTypes" jsonb,
	"scopes" jsonb,
	"skipConsent" boolean,
	"softwareId" text,
	"softwareStatement" text,
	"softwareVersion" text,
	"subjectType" text,
	"tokenEndpointAuthMethod" text,
	"tos" text,
	"updatedAt" timestamp,
	"uri" text,
	"userId" text
);
--> statement-breakpoint
CREATE TABLE "oauthClientAssertion" (
	"expiresAt" timestamp NOT NULL,
	"id" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "oauthClientResource" (
	"clientId" text NOT NULL,
	"createdAt" timestamp,
	"id" text PRIMARY KEY,
	"metadata" jsonb,
	"resourceId" text NOT NULL,
	CONSTRAINT "oauth_client_resource_client_resource_unique" UNIQUE("clientId","resourceId")
);
--> statement-breakpoint
CREATE TABLE "oauthConsent" (
	"clientId" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"referenceId" text,
	"requestedUserInfoClaims" jsonb,
	"resources" jsonb,
	"scopes" jsonb NOT NULL,
	"updatedAt" timestamp NOT NULL,
	"userId" text
);
--> statement-breakpoint
CREATE TABLE "oauthRefreshToken" (
	"authTime" timestamp,
	"authorizationCodeId" text,
	"clientId" text NOT NULL,
	"confirmation" jsonb,
	"createdAt" timestamp NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"referenceId" text,
	"requestedUserInfoClaims" jsonb,
	"resources" jsonb,
	"revoked" timestamp,
	"rotatedAt" timestamp,
	"rotationReplayExpiresAt" timestamp,
	"rotationReplayResponse" text,
	"scopes" jsonb NOT NULL,
	"sessionId" text,
	"token" text NOT NULL UNIQUE,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauthResource" (
	"accessTokenTtl" integer,
	"allowedScopes" jsonb,
	"createdAt" timestamp,
	"customClaims" jsonb,
	"disabled" boolean DEFAULT false,
	"dpopBoundAccessTokensRequired" boolean DEFAULT false,
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL UNIQUE,
	"metadata" jsonb,
	"name" text NOT NULL,
	"policyVersion" integer DEFAULT 1,
	"refreshTokenTtl" integer,
	"signingAlgorithm" text,
	"signingKeyId" text,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE INDEX "oauth_access_token_client_user_idx" ON "oauthAccessToken" ("clientId","userId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_session_id_idx" ON "oauthAccessToken" ("sessionId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_user_id_idx" ON "oauthAccessToken" ("userId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_refresh_id_idx" ON "oauthAccessToken" ("refreshId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_authorization_code_id_idx" ON "oauthAccessToken" ("authorizationCodeId");--> statement-breakpoint
CREATE INDEX "oauth_access_token_expires_at_idx" ON "oauthAccessToken" ("expiresAt");--> statement-breakpoint
CREATE INDEX "oauth_client_user_id_idx" ON "oauthClient" ("userId");--> statement-breakpoint
CREATE INDEX "oauth_client_created_at_idx" ON "oauthClient" ("createdAt");--> statement-breakpoint
CREATE INDEX "oauth_client_resource_resource_id_idx" ON "oauthClientResource" ("resourceId");--> statement-breakpoint
CREATE INDEX "oauth_consent_client_user_idx" ON "oauthConsent" ("clientId","userId");--> statement-breakpoint
CREATE INDEX "oauth_consent_user_id_idx" ON "oauthConsent" ("userId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_client_user_idx" ON "oauthRefreshToken" ("clientId","userId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_session_id_idx" ON "oauthRefreshToken" ("sessionId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_user_id_idx" ON "oauthRefreshToken" ("userId");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_expires_at_idx" ON "oauthRefreshToken" ("expiresAt");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_authorization_code_id_idx" ON "oauthRefreshToken" ("authorizationCodeId");--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_clientId_oauthClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_refreshId_oauthRefreshToken_id_fkey" FOREIGN KEY ("refreshId") REFERENCES "oauthRefreshToken"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_sessionId_session_id_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthAccessToken" ADD CONSTRAINT "oauthAccessToken_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthClient" ADD CONSTRAINT "oauthClient_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_clientId_oauthClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthClientResource" ADD CONSTRAINT "oauthClientResource_resourceId_oauthResource_identifier_fkey" FOREIGN KEY ("resourceId") REFERENCES "oauthResource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_clientId_oauthClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthConsent" ADD CONSTRAINT "oauthConsent_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_clientId_oauthClient_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "oauthClient"("clientId") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_sessionId_session_id_fkey" FOREIGN KEY ("sessionId") REFERENCES "session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "oauthRefreshToken" ADD CONSTRAINT "oauthRefreshToken_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;