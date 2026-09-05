CREATE TABLE "deviceCode" (
	"clientId" text,
	"deviceCode" text NOT NULL CONSTRAINT "device_code_device_code_unique" UNIQUE,
	"expiresAt" timestamp NOT NULL,
	"id" text PRIMARY KEY,
	"lastPolledAt" timestamp,
	"pollingInterval" integer,
	"scope" text,
	"status" text NOT NULL,
	"userCode" text NOT NULL CONSTRAINT "device_code_user_code_unique" UNIQUE,
	"userId" text
);
--> statement-breakpoint
CREATE INDEX "device_code_user_id_idx" ON "deviceCode" ("userId");--> statement-breakpoint
ALTER TABLE "deviceCode" ADD CONSTRAINT "deviceCode_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;