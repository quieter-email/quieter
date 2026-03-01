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
CREATE TABLE "invitation" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"teamId" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"createdAt" timestamp NOT NULL,
	"inviterId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "member_organizationId_userId_unique" UNIQUE("organizationId","userId")
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"metadata" text,
	"createdAt" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizationRole" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"role" text NOT NULL,
	"permission" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp,
	CONSTRAINT "organizationRole_organizationId_role_unique" UNIQUE("organizationId","role")
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" text PRIMARY KEY,
	"name" text,
	"publicKey" text NOT NULL,
	"userId" text NOT NULL,
	"credentialID" text NOT NULL UNIQUE,
	"counter" integer NOT NULL,
	"deviceType" text NOT NULL,
	"backedUp" boolean NOT NULL,
	"transports" text,
	"createdAt" timestamp NOT NULL,
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
	"userId" text NOT NULL,
	"activeOrganizationId" text,
	"activeTeamId" text
);
--> statement-breakpoint
CREATE TABLE "team" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"organizationId" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp
);
--> statement-breakpoint
CREATE TABLE "teamMember" (
	"id" text PRIMARY KEY,
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "teamMember_teamId_userId_unique" UNIQUE("teamId","userId")
);
--> statement-breakpoint
CREATE TABLE "twoFactor" (
	"id" text PRIMARY KEY,
	"secret" text NOT NULL,
	"backupCodes" text NOT NULL,
	"userId" text NOT NULL UNIQUE
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean NOT NULL,
	"image" text,
	"twoFactorEnabled" boolean DEFAULT false,
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
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_teamId_team_id_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "invitation" ADD CONSTRAINT "invitation_inviterId_user_id_fkey" FOREIGN KEY ("inviterId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "organizationRole" ADD CONSTRAINT "organizationRole_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_activeOrganizationId_organization_id_fkey" FOREIGN KEY ("activeOrganizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_activeTeamId_team_id_fkey" FOREIGN KEY ("activeTeamId") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id");--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_teamId_team_id_fkey" FOREIGN KEY ("teamId") REFERENCES "team"("id");--> statement-breakpoint
ALTER TABLE "teamMember" ADD CONSTRAINT "teamMember_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");--> statement-breakpoint
ALTER TABLE "twoFactor" ADD CONSTRAINT "twoFactor_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id");