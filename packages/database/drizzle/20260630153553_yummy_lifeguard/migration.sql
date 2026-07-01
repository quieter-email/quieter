CREATE TABLE "mailboxDivisionGrant" (
	"id" text PRIMARY KEY,
	"mailboxId" text NOT NULL,
	"divisionId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mailbox_division_grant_mailbox_division_unique" UNIQUE("mailboxId","divisionId"),
	CONSTRAINT "mailbox_division_grant_role_check" CHECK ("role" in ('reader', 'responder', 'manager'))
);
--> statement-breakpoint
CREATE TABLE "organizationDivision" (
	"id" text PRIMARY KEY,
	"organizationId" text NOT NULL,
	"name" text NOT NULL,
	"normalizedName" text NOT NULL,
	"description" text,
	"position" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "organization_division_organization_name_unique" UNIQUE("organizationId","normalizedName")
);
--> statement-breakpoint
CREATE TABLE "organizationDivisionMember" (
	"id" text PRIMARY KEY,
	"divisionId" text NOT NULL,
	"memberId" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	CONSTRAINT "organization_division_member_division_member_unique" UNIQUE("divisionId","memberId")
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "divisionId" text;--> statement-breakpoint
CREATE INDEX "mailbox_division_id_idx" ON "mailbox" ("divisionId");--> statement-breakpoint
CREATE INDEX "mailbox_division_grant_mailbox_id_idx" ON "mailboxDivisionGrant" ("mailboxId");--> statement-breakpoint
CREATE INDEX "mailbox_division_grant_division_id_idx" ON "mailboxDivisionGrant" ("divisionId");--> statement-breakpoint
CREATE INDEX "organization_division_organization_position_idx" ON "organizationDivision" ("organizationId","position");--> statement-breakpoint
CREATE INDEX "organization_division_member_division_id_idx" ON "organizationDivisionMember" ("divisionId");--> statement-breakpoint
CREATE INDEX "organization_division_member_member_id_idx" ON "organizationDivisionMember" ("memberId");--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_divisionId_organizationDivision_id_fkey" FOREIGN KEY ("divisionId") REFERENCES "organizationDivision"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "mailboxDivisionGrant" ADD CONSTRAINT "mailboxDivisionGrant_mailboxId_mailbox_id_fkey" FOREIGN KEY ("mailboxId") REFERENCES "mailbox"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailboxDivisionGrant" ADD CONSTRAINT "mailboxDivisionGrant_divisionId_organizationDivision_id_fkey" FOREIGN KEY ("divisionId") REFERENCES "organizationDivision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationDivision" ADD CONSTRAINT "organizationDivision_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationDivisionMember" ADD CONSTRAINT "organizationDivisionMember_l2IQrxE96fOG_fkey" FOREIGN KEY ("divisionId") REFERENCES "organizationDivision"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organizationDivisionMember" ADD CONSTRAINT "organizationDivisionMember_memberId_member_id_fkey" FOREIGN KEY ("memberId") REFERENCES "member"("id") ON DELETE CASCADE;