CREATE TABLE "mailTemplate" (
	"id" text PRIMARY KEY,
	"scope" text NOT NULL,
	"userId" text,
	"organizationId" text,
	"name" text NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"bodyHtml" text NOT NULL,
	"createdAt" timestamp NOT NULL,
	"updatedAt" timestamp NOT NULL,
	CONSTRAINT "mail_template_scope_owner_check" CHECK ((
        ("scope" = 'personal' and "userId" is not null and "organizationId" is null)
        or
        ("scope" = 'team' and "userId" is null and "organizationId" is not null)
      )),
	CONSTRAINT "mail_template_scope_check" CHECK ("scope" in ('personal', 'team')),
	CONSTRAINT "mail_template_name_length_check" CHECK (char_length("name") between 1 and 120),
	CONSTRAINT "mail_template_subject_length_check" CHECK (char_length("subject") <= 998),
	CONSTRAINT "mail_template_body_length_check" CHECK (char_length("bodyHtml") <= 100000)
);
--> statement-breakpoint
CREATE INDEX "mail_template_user_updated_idx" ON "mailTemplate" ("userId","updatedAt");--> statement-breakpoint
CREATE INDEX "mail_template_organization_updated_idx" ON "mailTemplate" ("organizationId","updatedAt");--> statement-breakpoint
ALTER TABLE "mailTemplate" ADD CONSTRAINT "mailTemplate_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "mailTemplate" ADD CONSTRAINT "mailTemplate_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;