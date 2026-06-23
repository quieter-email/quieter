INSERT INTO "organization" (
  "id",
  "billingOwnerUserId",
  "name",
  "slug",
  "createdAt",
  "updatedAt"
)
SELECT
  'default-org-' || md5("id"),
  "id",
  coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'team'
  ) || '-' || substr(md5("id"), 1, 6),
  coalesce(
    nullif(
      trim(both '-' from regexp_replace(lower("name"), '[^a-z0-9]+', '-', 'g')),
      ''
    ),
    'team'
  ) || '-' || substr(md5("id"), 1, 6),
  "createdAt",
  "updatedAt"
FROM "user";--> statement-breakpoint
INSERT INTO "member" ("id", "organizationId", "userId", "role", "createdAt")
SELECT
  'default-member-' || md5("id"),
  'default-org-' || md5("id"),
  "id",
  'owner',
  "createdAt"
FROM "user";--> statement-breakpoint
UPDATE "mailbox"
SET "organizationId" = 'default-org-' || md5("ownerUserId")
WHERE "organizationId" IS NULL AND "ownerUserId" IS NOT NULL;--> statement-breakpoint
UPDATE "gmailOAuthState"
SET "organizationId" = 'default-org-' || md5("userId")
WHERE "organizationId" IS NULL;--> statement-breakpoint
UPDATE "billingSubscription"
SET
  "organizationId" = coalesce(
    "organizationId",
    'default-org-' || md5("userId")
  ),
  "plan" = CASE
    WHEN "plan" IN ('personal', 'pro', 'team_ai') THEN 'pro'
    ELSE 'managed'
  END,
  "scope" = 'team';--> statement-breakpoint
UPDATE "billingCreditUsageEvent"
SET
  "organizationId" = coalesce(
    "organizationId",
    'default-org-' || md5("userId")
  ),
  "scope" = 'team',
  "userId" = NULL;--> statement-breakpoint
UPDATE "billingEntitlementOverride"
SET "plan" = CASE
  WHEN "plan" IN ('personal', 'pro', 'team_ai') THEN 'pro'
  ELSE 'managed'
END;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ALTER COLUMN "scope" SET DEFAULT 'team';--> statement-breakpoint
ALTER TABLE "billingSubscription" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "billingSubscription" ALTER COLUMN "scope" SET DEFAULT 'team';--> statement-breakpoint
ALTER TABLE "gmailOAuthState" ALTER COLUMN "organizationId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ALTER COLUMN "organizationId" SET NOT NULL;
