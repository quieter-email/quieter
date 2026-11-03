-- quieter:contract
-- Reviewed expansion: relax provider checks; existing rows remain valid.
ALTER TABLE "connectorOAuthState" ADD COLUMN "connectionId" text;--> statement-breakpoint
ALTER TABLE "connectorOAuthState" ADD COLUMN "sessionHash" text;--> statement-breakpoint
ALTER TABLE "connectorCredential" DROP CONSTRAINT "connector_credential_provider_check", ADD CONSTRAINT "connector_credential_provider_check" CHECK ("provider" in ('google_calendar', 'linear', 'notion', 'todoist', 'clickup', 'microsoft_calendar', 'microsoft_onedrive'));--> statement-breakpoint
ALTER TABLE "connectorOAuthState" DROP CONSTRAINT "connector_oauth_state_provider_check", ADD CONSTRAINT "connector_oauth_state_provider_check" CHECK ("provider" in ('google_calendar', 'linear', 'notion', 'todoist', 'clickup', 'microsoft_calendar', 'microsoft_onedrive'));