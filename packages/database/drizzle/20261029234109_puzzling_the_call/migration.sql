-- quieter:contract
ALTER TABLE "mailDomain" ADD COLUMN "ownershipVerifiedAt" timestamp;--> statement-breakpoint
UPDATE "mailDomain" SET "ownershipVerifiedAt" = COALESCE("verifiedAt", "updatedAt")
WHERE "status" = 'verified' OR "verifiedAt" IS NOT NULL OR EXISTS (
  SELECT 1 FROM "mailbox"
  WHERE "mailbox"."organizationId" = "mailDomain"."organizationId"
    AND "mailbox"."provider" = 'managed'
    AND lower(split_part("mailbox"."emailAddress", '@', 2)) = "mailDomain"."domain"
);--> statement-breakpoint
CREATE FUNCTION "preserveMailDomainOwnership"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."ownershipVerifiedAt" := COALESCE(
    OLD."ownershipVerifiedAt",
    NEW."ownershipVerifiedAt",
    NEW."verifiedAt",
    CASE WHEN NEW."status" = 'verified' THEN CURRENT_TIMESTAMP END
  );
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "mail_domain_preserve_ownership"
BEFORE UPDATE ON "mailDomain"
FOR EACH ROW EXECUTE FUNCTION "preserveMailDomainOwnership"();
