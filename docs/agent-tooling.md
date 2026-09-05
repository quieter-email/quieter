# Agent debugging tools

Application credentials, agent access, and feature acceptance are separate checks. A local app can run while an agent has no access to its provider logs. Sentry and PostHog capture remain off locally by default; agents still need authenticated inspection access.

Run `vp run agent:doctor` to check required Codex MCP configuration and saved OAuth status without printing headers, tokens, or command arguments. Exit code 1 means configuration or authentication is missing. Exit code 0 only means those inventory checks passed. It does not establish that the active task can discover tools or make authorized provider calls.

## Readiness recorded September 5, 2026

| Service | Configuration and authentication | Read evidence and remaining gap |
| --- | --- | --- |
| Sentry | Official hosted MCP was missing. The separate production debugging task added it and completed OAuth | This audit task cannot discover Sentry tools. A successful issue read through MCP is still required here; browser access and an installed API-script skill do not prove MCP readiness |
| PlanetScale | Added official hosted MCP and completed OAuth for only `quieter`. Production/development branch access is read-only; organization-wide and billing access were left unselected | CLI access and the development database were verified previously. MCP tool discovery and a read query remain unverified in this task |
| Cloudflare operations | `cloudflare`, `cloudflare-bindings`, `cloudflare-builds`, and `cloudflare-observability` are configured with saved OAuth | This task exposes only Cloudflare documentation tools. Operational MCP reads remain unverified; dashboard and Wrangler access were exercised earlier |
| AWS | `aws-mcp` configured; AWS SSO credentials available | MCP `GetCallerIdentity` succeeded with `quieter-readonly`. Resource/log permissions require resource-specific reads; the identity check does not prove all permissions |
| Polar production | Hosted `polar` MCP authenticated | `organizations_list` returned `quieter-email` through search, describe, execute |
| Polar sandbox | Hosted endpoint configured, OAuth login fails | Codex 0.147.0 rejected the callback: expected issuer `https://mcp.polar.sh/mcp/polar-sandbox`, received `https://sandbox-api.polar.sh`. Sandbox API token and official CLI webhook delivery work separately. MCP remains blocked |
| PostHog | Bundled app connector available; independent of `codex mcp list` | Authenticated `projects_get` returned `quieter` and `quieter-staging`. Local telemetry remains off |
| Google Cloud | Authenticated gcloud CLI and dashboard, separate development Pub/Sub subscription | Prior subscription inspection succeeded. Mailbox OAuth consent is separate from gcloud sign-in; provider write acceptance remains open |
| SST | CLI and linked development secrets | Local SST startup and fresh-checkout secret pull passed. Use runtime logs and stage inspection; secret values must not be printed |
| OpenRouter | Separate capped development key, provider dashboard/API | Real API generation and application chat passed. No dedicated MCP is required for these probes |
| Linear | Application connector configured | Separate test workspace/OAuth client and real connector acceptance remain open. No independently verified agent MCP connection in this audit |
| GitHub | Authenticated `gh` CLI | Branch push and PR 276 update passed. No additional connector is needed for the verified repository operations |
| logo.dev / c15t | Application configuration / offline consent runtime | Validate network and UI behavior in Chrome. No agent MCP is required |
| Domain Connect | Inactive | Deferred until integration activation |

PlanetScale's MCP creates temporary read-only credentials for SQL execution. The user approved that mechanism for this connection. It does not authorize production writes, schema changes, restores, deployments, or persistent role changes. `quieter_dev` is a logical database on the production `main` branch, so selecting only PlanetScale development branches would not provide access to it.

## Bootstrap and verification

Use the [official Sentry MCP](https://mcp.sentry.dev/), [PlanetScale MCP](https://planetscale.com/docs/mcp-server), and [Polar MCP](https://polar.sh/docs/integrate/mcp). First inspect existing entries; do not overwrite another agent's in-progress OAuth setup or start duplicate login flows.

```bash
codex mcp get sentry
codex mcp get planetscale
codex mcp get polar_sandbox
```

When an entry is missing:

```bash
codex mcp add sentry --url https://mcp.sentry.dev/mcp
codex mcp add planetscale --url https://mcp.pscale.dev/mcp/planetscale
codex mcp add polar_sandbox --url https://mcp.polar.sh/mcp/polar-sandbox
```

For an existing connection, use `codex mcp login <name>` when reauthentication is needed. Limit Sentry to issue/event inspection and PlanetScale to the specific database with read-only branch access. Do not bypass issuer validation to work around the Polar sandbox failure. Use the existing SST-backed sandbox API credential and official CLI while resolving the provider/client incompatibility.

After setup, verify tool discovery in the task that will do the debugging. If configured tools are absent, reload MCP connections or restart Codex and check again. Record the actual failure if they remain unavailable. A successful browser login is insufficient.

Complete a small read against each provider needed for the feature:

1. Sentry: list the Quieter project and retrieve one issue's error details. Confirm project and environment before interpreting results.
2. PlanetScale: inspect `quieter/main` metadata and Insights. For SQL, explicitly target the logical database and use a bounded read such as `SELECT current_database()`. Never infer the logical database from the branch name.
3. Cloudflare: list the account's Workers and retrieve a bounded log or observability result for the relevant Worker. Documentation search does not pass this check.
4. AWS: use `quieter-readonly` for STS identity, then inspect the relevant Lambda or bounded CloudWatch logs. The MCP `call_boto3` expects operation names such as `GetCallerIdentity`, not `get_caller_identity`.
5. Polar: discover and describe `organizations_list`, execute it, and confirm the expected environment's organization. Repeat independently for sandbox.
6. PostHog: list accessible projects through its app connector, then scope any data read to Quieter or its staging project.

Keep MCP OAuth credentials in Codex's credential store. Application development tokens stay in SST Secrets and ignored local caches. Do not paste raw inventory/configuration, OAuth callback URLs, or provider responses containing credentials into reports.

## Completion criteria

For each integration changed, record the startup command, secret source, authenticated inspection tool, safe test resource, successful feature exercise, and failure logs. Record blocked steps with the exact required action. A mock test, saved OAuth token, working CLI, or successful homepage load proves only that individual check. Full local-development readiness remains incomplete until the open acceptance items in [Development service audit](development-services.md) pass.
