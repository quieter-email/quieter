-- quieter:contract
ALTER TABLE "mailDomain" ADD COLUMN "ownershipVerifiedAt" timestamp;--> statement-breakpoint
UPDATE "mailDomain" SET "ownershipVerifiedAt" = COALESCE("verifiedAt", "updatedAt")
WHERE "status" = 'verified' OR "verifiedAt" IS NOT NULL OR EXISTS (
  SELECT 1 FROM "mailbox"
  WHERE "mailbox"."organizationId" = "mailDomain"."organizationId"
    AND "mailbox"."provider" = 'managed'
    AND lower(split_part("mailbox"."emailAddress", '@', 2)) = "mailDomain"."domain"
);
