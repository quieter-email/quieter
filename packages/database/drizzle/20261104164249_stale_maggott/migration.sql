-- quieter:contract
CREATE TABLE "mailboxPersonalAgentSetting" (
	"activatedAt" timestamp,
	"activationVersion" integer DEFAULT 0 NOT NULL,
	"activeRevisionId" text,
	"createdAt" timestamp NOT NULL,
	"draftRevisionId" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"mailboxId" text,
	"memberId" text,
	"updatedAt" timestamp NOT NULL,
	"userId" text,
	"version" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mailboxPersonalAgentSetting_pkey" PRIMARY KEY("mailboxId","userId")
);
--> statement-breakpoint
ALTER TABLE "mailboxGrant" ADD COLUMN "memberId" text;--> statement-breakpoint
CREATE INDEX "mailbox_grant_member_id_idx" ON "mailboxGrant" ("memberId");--> statement-breakpoint
CREATE INDEX "mailbox_personal_agent_setting_member_idx" ON "mailboxPersonalAgentSetting" ("memberId");--> statement-breakpoint
CREATE INDEX "mailbox_personal_agent_setting_user_idx" ON "mailboxPersonalAgentSetting" ("userId");--> statement-breakpoint
ALTER TABLE "mailboxGrant" ADD CONSTRAINT "mailboxGrant_memberId_member_id_fkey" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxPersonalAgentSetting" ADD CONSTRAINT "mailboxPersonalAgentSetting_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxPersonalAgentSetting" ADD CONSTRAINT "mailboxPersonalAgentSetting_memberId_member_id_fkey" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxPersonalAgentSetting" ADD CONSTRAINT "mailboxPersonalAgentSetting_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;
--> statement-breakpoint
UPDATE "mailboxGrant" AS grant_row
SET "memberId" = current_member.id
FROM mailbox AS inbox, member AS current_member
WHERE inbox.id = grant_row."mailboxId"
  AND current_member."organizationId" = inbox."organizationId"
  AND current_member."userId" = grant_row."userId";
--> statement-breakpoint
WITH owners AS (
  SELECT saved."mailboxId", saved."activatedByUserId" AS "userId"
  FROM "mailboxAgentSetting" AS saved
  JOIN "mailboxAgentRevision" AS active_revision
    ON active_revision.id = saved."activeRevisionId"
    AND active_revision."mailboxId" = saved."mailboxId"
    AND active_revision."createdByUserId" = saved."activatedByUserId"
  UNION
  SELECT saved."mailboxId", draft_revision."createdByUserId" AS "userId"
  FROM "mailboxAgentSetting" AS saved
  JOIN "mailboxAgentRevision" AS draft_revision
    ON draft_revision.id = saved."draftRevisionId"
    AND draft_revision."mailboxId" = saved."mailboxId"
)
INSERT INTO "mailboxPersonalAgentSetting" (
  "mailboxId", "userId", "memberId", "activatedAt", "activationVersion",
  "activeRevisionId", "createdAt", "draftRevisionId", enabled, "updatedAt", version
)
SELECT saved."mailboxId", owners."userId",
  CASE WHEN inbox.provider = 'managed' THEN current_member.id ELSE NULL END,
  CASE WHEN active_revision."createdByUserId" = owners."userId" THEN saved."activatedAt" END,
  saved."activationVersion",
  CASE WHEN active_revision."createdByUserId" = owners."userId"
    AND saved."activatedByUserId" = owners."userId" THEN active_revision.id END,
  saved."createdAt",
  CASE WHEN draft_revision."createdByUserId" = owners."userId" THEN draft_revision.id END,
  COALESCE(saved.enabled AND active_revision."createdByUserId" = owners."userId"
    AND saved."activatedByUserId" = owners."userId", false),
  saved."updatedAt", saved.version
FROM owners
JOIN "mailboxAgentSetting" AS saved ON saved."mailboxId" = owners."mailboxId"
JOIN mailbox AS inbox ON inbox.id = saved."mailboxId"
LEFT JOIN member AS current_member ON current_member."userId" = owners."userId"
  AND current_member."organizationId" = inbox."organizationId"
LEFT JOIN "mailboxAgentRevision" AS active_revision
  ON active_revision.id = saved."activeRevisionId"
  AND active_revision."mailboxId" = saved."mailboxId"
LEFT JOIN "mailboxAgentRevision" AS draft_revision
  ON draft_revision.id = saved."draftRevisionId"
  AND draft_revision."mailboxId" = saved."mailboxId"
WHERE (inbox.provider = 'managed' AND current_member.id IS NOT NULL)
  OR (inbox.provider = 'gmail' AND inbox."ownerUserId" = owners."userId");
