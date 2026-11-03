-- quieter:contract
CREATE FUNCTION "admitOpenLifecycleMembership"() RETURNS trigger
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  account_closing timestamp;
  team_closing timestamp;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."userId" = OLD."userId" AND NEW."organizationId" = OLD."organizationId" THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM id FROM "user" WHERE id = NEW."userId" FOR UPDATE;
  PERFORM id FROM organization WHERE id = NEW."organizationId" FOR UPDATE;
  SELECT "deletionRequestedAt" INTO account_closing
  FROM "billingAccountSettings" WHERE "userId" = NEW."userId";
  SELECT "billingDeletionRequestedAt" INTO team_closing
  FROM organization WHERE id = NEW."organizationId";
  IF account_closing IS NOT NULL THEN
    RAISE EXCEPTION 'Your account is closing. Finish deleting it before creating or joining a team.'
      USING ERRCODE = '23514', CONSTRAINT = 'member_open_account_lifecycle';
  END IF;
  IF team_closing IS NOT NULL THEN
    RAISE EXCEPTION 'This team is closing and cannot accept new members.'
      USING ERRCODE = '23514', CONSTRAINT = 'member_open_organization_lifecycle';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "member_admit_open_lifecycle"
BEFORE INSERT OR UPDATE OF "organizationId", "userId" ON member
FOR EACH ROW EXECUTE FUNCTION "admitOpenLifecycleMembership"();
