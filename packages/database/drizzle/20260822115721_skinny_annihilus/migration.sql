ALTER TABLE "mailbox" ADD COLUMN "accessMode" text DEFAULT 'shared' NOT NULL;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_access_mode_check" CHECK ("accessMode" in ('private', 'shared'));--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_private_division_check" CHECK (("accessMode" = 'shared' or "divisionId" is null));--> statement-breakpoint
ALTER TABLE "mailbox" DROP CONSTRAINT "mailbox_provider_ownership_check", ADD CONSTRAINT "mailbox_provider_ownership_check" CHECK ((
        ("provider" = 'gmail' and "ownerUserId" is not null)
        or
        ("provider" = 'managed' and "accessMode" = 'private' and "ownerUserId" is not null and "organizationId" is not null)
        or
        ("provider" = 'managed' and "accessMode" = 'shared' and "ownerUserId" is null and "organizationId" is not null)
      ));