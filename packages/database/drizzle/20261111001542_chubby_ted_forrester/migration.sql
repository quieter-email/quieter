CREATE TABLE "platformAdmin" (
	"grantedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"userId" text PRIMARY KEY
);
--> statement-breakpoint
CREATE TABLE "waitlistSettingRevision" (
	"actorUserId" text,
	"changedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "waitlistSettingRevision_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"waitlistOpen" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "platformAdmin" ADD CONSTRAINT "platformAdmin_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "waitlistSettingRevision" ADD CONSTRAINT "waitlistSettingRevision_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE SET NULL;