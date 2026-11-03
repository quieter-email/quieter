-- quieter:contract
ALTER TABLE "billingAccountSettings" ADD COLUMN "checkoutProviderProductId" text;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "liabilityWriteOff" jsonb;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "liabilityWrittenOffAt" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD COLUMN "polarEventAttemptedAt" timestamp;--> statement-breakpoint
ALTER TABLE "billingCreditUsageEvent" ADD CONSTRAINT "billing_credit_usage_event_write_off_check" CHECK ("liabilityWrittenOffAt" is null or ("liabilityWriteOff" is not null and "billableCostMicroCents" = 0));
--> statement-breakpoint
UPDATE "billingCreditUsageEvent" SET "polarEventAttemptedAt" = now() WHERE "billableCostMicroCents" > 0 AND "polarEventReportedAt" IS NULL AND "polarEventAttemptedAt" IS NULL;
--> statement-breakpoint
CREATE FUNCTION "preserveOrganizationFundingMembership"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  payer_id text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."organizationId" = OLD."organizationId"
      AND NEW."userId" = OLD."userId"
      AND 'owner' = ANY(string_to_array(NEW.role, ',')) THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM id FROM organization WHERE id = OLD."organizationId" FOR UPDATE;
  -- A separate query observes a payer assigned while the row lock was awaited.
  SELECT "billingOwnerUserId" INTO payer_id
  FROM organization WHERE id = OLD."organizationId";
  IF payer_id = OLD."userId" THEN
    RAISE EXCEPTION 'Another team owner must accept taking over billing before the current payer can leave, be removed, or lose the owner role.'
      USING ERRCODE = '23514', CONSTRAINT = 'organization_funding_owner_membership';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER "member_preserve_organization_funding"
BEFORE DELETE OR UPDATE OF "organizationId", "userId", role ON member
FOR EACH ROW EXECUTE FUNCTION "preserveOrganizationFundingMembership"();

--> statement-breakpoint
CREATE FUNCTION "validateOrganizationFundingMembership"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  IF NEW."billingOwnerUserId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM member
    WHERE "organizationId" = NEW.id
      AND "userId" = NEW."billingOwnerUserId"
      AND 'owner' = ANY(string_to_array(role, ','))
  ) THEN
    RAISE EXCEPTION 'Only a team owner can take over billing.'
      USING ERRCODE = '23514', CONSTRAINT = 'organization_funding_owner_membership';
  END IF;
  RETURN NEW;
END;
$$;

--> statement-breakpoint
CREATE TRIGGER "organization_validate_funding_owner"
BEFORE INSERT OR UPDATE OF "billingOwnerUserId" ON organization
FOR EACH ROW EXECUTE FUNCTION "validateOrganizationFundingMembership"();
