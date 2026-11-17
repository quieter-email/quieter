CREATE TABLE "managementReadAuditEvent" (
	"actorUserId" text NOT NULL,
	"connectionId" text,
	"createdAt" timestamp with time zone NOT NULL,
	"credentialId" text NOT NULL,
	"credentialKind" text NOT NULL,
	"eventKind" text NOT NULL,
	"id" uuid PRIMARY KEY,
	"mailboxId" text,
	"operationId" text,
	"organizationId" text,
	"outcomeCode" text NOT NULL,
	"targetKind" text,
	CONSTRAINT "management_read_audit_credential_check" CHECK ("credentialKind" = 'session' and length(btrim("actorUserId")) > 0 and length(btrim("credentialId")) > 0 and length("credentialId") <= 255),
	CONSTRAINT "management_read_audit_operation_check" CHECK ("operationId" is null or "operationId" in ('control.discover', 'mailboxes.list', 'mail.search', 'mail.read_thread', 'calendar.accounts', 'calendar.list', 'calendar.events', 'calendar.event')),
	CONSTRAINT "management_read_audit_target_check" CHECK (case
        when "targetKind" is null then "organizationId" is null and "mailboxId" is null and "connectionId" is null
        when "targetKind" = 'user' then "organizationId" is null and "mailboxId" is null and "connectionId" is null
        when "targetKind" = 'mailbox' then "organizationId" is not null and "mailboxId" is not null and length(btrim("organizationId")) > 0 and length(btrim("mailboxId")) > 0 and "connectionId" is null
        when "targetKind" = 'calendar' then "connectionId" is not null and length(btrim("connectionId")) > 0 and "organizationId" is null and "mailboxId" is null
        else false
      end),
	CONSTRAINT "management_read_audit_event_check" CHECK (case "eventKind"
        when 'discovered' then "operationId" is not null and "operationId" = 'control.discover' and "outcomeCode" = 'SUCCEEDED'
        when 'executed' then "operationId" is not null and "operationId" <> 'control.discover' and "outcomeCode" = 'SUCCEEDED'
        when 'denied' then "targetKind" is null and "outcomeCode" in ('BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'REAUTHENTICATION_REQUIRED', 'UNSUPPORTED_OPERATION')
        when 'failed' then "outcomeCode" in ('BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'RATE_LIMITED', 'REAUTHENTICATION_REQUIRED', 'CANCELLED', 'UNSUPPORTED_OPERATION', 'INTERNAL_ERROR')
        else false
      end),
	CONSTRAINT "management_read_audit_operation_target_check" CHECK (case
        when "targetKind" is null then "eventKind" <> 'executed'
        when "operationId" is null then false
        when "operationId" = 'control.discover' then true
        when "operationId" in ('mailboxes.list', 'calendar.accounts') then "targetKind" = 'user'
        when "operationId" in ('mail.search', 'mail.read_thread') then "targetKind" = 'mailbox'
        when "operationId" in ('calendar.list', 'calendar.events', 'calendar.event') then "targetKind" = 'calendar'
        else false
      end)
);
--> statement-breakpoint
CREATE INDEX "management_read_audit_actor_created_idx" ON "managementReadAuditEvent" ("actorUserId","createdAt","id");--> statement-breakpoint
CREATE INDEX "management_read_audit_organization_created_idx" ON "managementReadAuditEvent" ("organizationId","createdAt","id");--> statement-breakpoint
ALTER TABLE "managementReadAuditEvent" ADD CONSTRAINT "managementReadAuditEvent_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;