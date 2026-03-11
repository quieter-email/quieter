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
	"senderAvatarLightUrl" text,
	"senderAvatarDarkUrl" text,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "gmailMessageCache_userId_messageId_unique" UNIQUE("userId","messageId")
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
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean NOT NULL,
	"image" text,
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
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "gmailMailboxState" ADD CONSTRAINT "gmailMailboxState_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "gmailMessageCache" ADD CONSTRAINT "gmailMessageCache_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");