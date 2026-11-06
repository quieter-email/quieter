-- quieter:contract
UPDATE "mailboxGrant" AS saved_grant
SET "memberId" = NULL
FROM mailbox AS inbox, member AS current_member
WHERE saved_grant."mailboxId" = inbox.id
  AND saved_grant."memberId" = current_member.id
  AND saved_grant."userId" = current_member."userId"
  AND inbox."organizationId" = current_member."organizationId"
  AND current_member."createdAt" > saved_grant."updatedAt";
--> statement-breakpoint
UPDATE "mailboxPersonalAgentSetting" AS setting
SET enabled = false,
  "activeRevisionId" = NULL,
  "activatedAt" = NULL,
  version = setting.version + 1,
  "activationVersion" = setting."activationVersion" + 1
FROM mailbox AS inbox, member AS current_member
WHERE setting."mailboxId" = inbox.id
  AND inbox.provider = 'managed'
  AND setting."memberId" = current_member.id
  AND setting."userId" = current_member."userId"
  AND inbox."organizationId" = current_member."organizationId"
  AND setting."activeRevisionId" IS NOT NULL
  AND (setting."activatedAt" IS NULL OR setting."activatedAt" < current_member."createdAt");
