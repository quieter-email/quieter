CREATE TABLE "managementMutation" (
	"actorUserId" text NOT NULL,
	"approvedAt" timestamp with time zone,
	"completedAt" timestamp with time zone,
	"createdAt" timestamp with time zone NOT NULL,
	"credentialId" text NOT NULL,
	"credentialKind" text NOT NULL,
	"errorCode" text,
	"expiresAt" timestamp with time zone NOT NULL,
	"id" text PRIMARY KEY,
	"idempotencyKey" text NOT NULL,
	"mailboxId" text,
	"operation" text NOT NULL,
	"organizationId" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"requestHash" text NOT NULL,
	"result" jsonb,
	"status" text NOT NULL,
	CONSTRAINT "management_mutation_replay_unique" UNIQUE("actorUserId","credentialKind","credentialId","idempotencyKey"),
	CONSTRAINT "management_mutation_scope_check" CHECK ("credentialKind" = 'session'
        and "operation" = 'organization.settings.update'
        and "mailboxId" is null),
	CONSTRAINT "management_mutation_identity_check" CHECK (length(btrim("credentialId")) > 0
        and length("credentialId") <= 255
        and length("idempotencyKey") between 1 and 255
        and "idempotencyKey" = btrim("idempotencyKey")
        and "requestHash" ~ '^v1:[a-f0-9]{64}$'),
	CONSTRAINT "management_mutation_parameters_check" CHECK (case when jsonb_typeof("parameters") = 'object' then
        "parameters" <> '{}'::jsonb
        and "parameters" - array['allowPerSendOverride', 'openTrackingEnabled'] = '{}'::jsonb
        and (not ("parameters" ? 'allowPerSendOverride') or jsonb_typeof("parameters"->'allowPerSendOverride') = 'boolean')
        and (not ("parameters" ? 'openTrackingEnabled') or jsonb_typeof("parameters"->'openTrackingEnabled') = 'boolean')
        else false end),
	CONSTRAINT "management_mutation_result_check" CHECK ("result" is null or case when jsonb_typeof("result") = 'object' then
        "result" ?& array['allowPerSendOverride', 'openTrackingEnabled']
        and "result" - array['allowPerSendOverride', 'openTrackingEnabled'] = '{}'::jsonb
        and jsonb_typeof("result"->'allowPerSendOverride') = 'boolean'
        and jsonb_typeof("result"->'openTrackingEnabled') = 'boolean'
        else false end),
	CONSTRAINT "management_mutation_error_check" CHECK ("errorCode" is null or "errorCode" in (
        'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
        'RATE_LIMITED', 'REAUTHENTICATION_REQUIRED', 'CANCELLED', 'UNSUPPORTED_OPERATION', 'INTERNAL_ERROR'
      )),
	CONSTRAINT "management_mutation_time_check" CHECK ("expiresAt" > "createdAt"
        and ("approvedAt" is null or (
          "approvedAt" >= "createdAt" and "approvedAt" < "expiresAt"
        ))
        and ("completedAt" is null or (
          "completedAt" >= "createdAt"
          and ("approvedAt" is null or "completedAt" >= "approvedAt")
        ))),
	CONSTRAINT "management_mutation_state_check" CHECK ((
        "status" = 'prepared' and "approvedAt" is null
        and "completedAt" is null and "result" is null and "errorCode" is null
      ) or (
        "status" = 'approved' and "approvedAt" is not null
        and "completedAt" is null and "result" is null and "errorCode" is null
      ) or (
        "status" = 'succeeded' and "approvedAt" is not null
        and "completedAt" is not null and "result" is not null and "errorCode" is null
      ) or (
        "status" = 'failed' and "completedAt" is not null
        and "result" is null and "errorCode" is not null
      ) or (
        "status" in ('cancelled', 'expired') and "completedAt" is not null
        and "result" is null and "errorCode" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "managementMutationAuditEvent" (
	"actorUserId" text NOT NULL,
	"createdAt" timestamp with time zone NOT NULL,
	"credentialId" text NOT NULL,
	"credentialKind" text NOT NULL,
	"eventKind" text NOT NULL,
	"id" text PRIMARY KEY,
	"mailboxId" text,
	"mutationId" text,
	"operation" text NOT NULL,
	"organizationId" text,
	"outcomeCode" text NOT NULL,
	CONSTRAINT "management_mutation_audit_scope_check" CHECK ("credentialKind" = 'session'
        and "operation" = 'organization.settings.update'
        and "mailboxId" is null
        and length(btrim("actorUserId")) > 0
        and length(btrim("credentialId")) > 0
        and length("credentialId") <= 255),
	CONSTRAINT "management_mutation_audit_event_check" CHECK ("eventKind" in ('prepared', 'approved', 'executed', 'replayed', 'cancelled', 'expired', 'denied', 'failed')),
	CONSTRAINT "management_mutation_audit_outcome_check" CHECK ("outcomeCode" in (
        'BAD_REQUEST', 'UNAUTHORIZED', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT',
        'RATE_LIMITED', 'REAUTHENTICATION_REQUIRED', 'CANCELLED', 'UNSUPPORTED_OPERATION', 'INTERNAL_ERROR',
        'PREPARED', 'APPROVED', 'EXECUTED', 'REPLAYED', 'SUCCEEDED', 'EXPIRED'
      ))
);
--> statement-breakpoint
CREATE INDEX "management_mutation_actor_target_created_idx" ON "managementMutation" ("actorUserId","organizationId","createdAt");--> statement-breakpoint
CREATE INDEX "management_mutation_status_expiry_idx" ON "managementMutation" ("status","expiresAt");--> statement-breakpoint
CREATE INDEX "management_mutation_audit_mutation_created_idx" ON "managementMutationAuditEvent" ("mutationId","createdAt");--> statement-breakpoint
CREATE INDEX "management_mutation_audit_organization_created_idx" ON "managementMutationAuditEvent" ("organizationId","createdAt");--> statement-breakpoint
ALTER TABLE "managementMutation" ADD CONSTRAINT "managementMutation_actorUserId_user_id_fkey" FOREIGN KEY ("actorUserId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managementMutation" ADD CONSTRAINT "managementMutation_organizationId_organization_id_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "managementMutationAuditEvent" ADD CONSTRAINT "managementMutationAuditEvent_mjznh6nEO2d5_fkey" FOREIGN KEY ("mutationId") REFERENCES "managementMutation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "managementMutationAuditEvent" ADD CONSTRAINT "managementMutationAuditEvent_lL03jVmbn3OS_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE;