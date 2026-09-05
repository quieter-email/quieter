# Development

## Prerequisites

Agent debugging access has separate requirements from the application runtime. Run `vp run agent:doctor` and complete the read probes in [Agent tooling](agent-tooling.md). Local Sentry/PostHog capture stays off by default; their inspection tools should still be available to agents.

- Vite+ (`vp`), which manages the pinned Node runtime and dependency installs
- Git
- Access to the allowlisted PlanetScale `quieter_dev` logical database
- AWS SSO access when loading development SST Secrets
- OAuth and provider credentials for integrations you want to test

Normal development uses `quieter_dev` on the existing PlanetScale cluster, with its exact hostname pinned by `QUIETER_LOCAL_PLANETSCALE_HOST`. It has separate data and database roles but shares compute, storage capacity, and availability with production. Do not provision another paid branch/cluster for development. Loopback PostgreSQL remains supported for optional disposable tests; it is not a daily prerequisite. Arbitrary hosted databases and the production `quieter` logical database remain rejected.

See [Development integration plan](development-integrations.md) for the accepted provider setup, shared-Gmail ownership rules, secret handling, and work still needed for complete local feature coverage.

## Install

```bash
git clone https://github.com/quieter-email/quieter.git
cd quieter
vp install --frozen-lockfile
cp .env.example .env.local
```

On PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Do not copy production database credentials or persistent queue endpoints into `.env.local`. Run `vp run env:doctor` after editing `.env.local`; it rejects unknown remote databases, production-shaped background infrastructure, and non-sandbox Polar credentials.

## Development database

Use the dev application role through PgBouncer for `DATABASE_URL`, the dev migrator role through the direct endpoint for `DATABASE_MIGRATION_URL`, and pin their shared hostname:

```text
DATABASE_URL=postgresql://app:password@your-host.pg.psdb.cloud:6432/quieter_dev?sslmode=verify-full
DATABASE_MIGRATION_URL=postgresql://migrator:password@your-host.pg.psdb.cloud:5432/quieter_dev?sslmode=verify-full
QUIETER_DEPLOYMENT_ENV=local
QUIETER_LOCAL_PLANETSCALE_HOST=your-host.pg.psdb.cloud
```

The local guards accept only that exact host, the `quieter_dev` database, TLS verification, port 6432 for application traffic, and port 5432 for migrations. The production `quieter` database is always rejected locally.

Apply committed application migrations after checking the target database and reconciling any existing migration-history mismatch:

```bash
vp run db:migrate
```

`db:push` is reserved for disposable local databases. Normal schema changes require a committed Drizzle migration.

## Environment

Start with `.env.example`. Environment variables are validated by `@quieter/env`:

- `@quieter/env/client`: browser-visible `VITE_*` values
- `@quieter/env/public`: shared public values
- `@quieter/env/server`: web and package runtime values
- `@quieter/env/sst`: SST deployment requirements
- `@quieter/env/deployment`: production deployment requirements

Local development requires only the values needed by the paths you exercise. Important groups:

- `DATABASE_URL`: loopback PostgreSQL or the explicitly allowlisted PlanetScale `quieter_dev` app role on port 6432
- `DATABASE_MIGRATION_URL`: the PlanetScale `quieter_dev` migrator role on direct port 5432; optional on loopback, where migration commands fall back to `DATABASE_URL`
- Better Auth: application URL and secret
- Auth email mode: `QUIETER_AUTH_MAIL_MODE=console` prints local auth links without managed mail
- Google identity OAuth: sign-in only
- Google Gmail OAuth: separate client for mailbox authorization
- Gmail credential encryption keys
- OpenRouter: chat and mailbox AI features
- SST: development Secret links and local process startup
- Polar: checkout and subscription flows
- PostHog, Sentry, and logo.dev: optional integrations

## Running

For the SST-managed local session, sign in to the development AWS profile and run:

```bash
vp run dev:sst --stage local-leander
```

Use your own `local-<name>` stage on another machine. `sst.local.config.ts` registers only development Secret links and a DevCommand, then starts both local runtimes through Vite+. It rejects production stage names and ordinary deployment. It creates no managed-mail resources, cloud Workers or paid database branches. The linked-secret bootstrap refreshes the ignored local cache before startup. `dev:cloud` is an alias for this command. Stop any separately running web/background sessions first.

To start only the web app using the existing local secret cache:

```bash
vp run dev
```

This starts the web app in Cloudflare's local Worker runtime on `http://localhost:3000`. Vite validates the development database destination before serving. Use `vp run dev:full` for the web app plus the background Worker on port 8787. Use `vp run dev:workers` to start only the background runtime alongside an already-running web app.

`dev:prepare` generates ignored `.dev.vars` from the validated local settings. It excludes migration credentials and supplies the linked live-sync signing secret. Restart both runtimes after changing secrets or Worker bindings. A Vite hot reload alone does not refresh a separate Wrangler process.

```bash
vp run dev:setup
vp run dev:full
# In another terminal, for real Gmail notifications:
vp run dev:pubsub
# Explicit scheduled-handler invocations:
vp run dev:trigger health
vp run dev:trigger maintenance
vp run dev:trigger actions
```

The local Worker delegates to the real Gmail queue consumer, action consumer, maintenance handler, dispatcher and realtime Durable Object. Queues, retries and Durable Object storage run in native workerd. Development combines these handlers in one process; production still deploys separate Workers. Maintenance and dispatch are manual triggers, not an automatically running cron. The Pub/Sub bridge uses `gcloud auth print-access-token`, pulls one message at a time from its own subscription, and acknowledges only after the local queue accepts the message.

Shared Gmail accounts default to `QUIETER_LOCAL_PROVIDER_MODE=observe` and `QUIETER_LOCAL_GMAIL_WATCH_OWNER=production`. Mail reads and AI results stored in `quieter_dev` work in this mode. Gmail, Calendar and Linear writes are rejected server-side. Auto-label classification is saved without applying labels. Write tests require a dedicated mailbox or a verified ownership handoff, plus the explicit Gmail account allowlist. Never start a competing consumer on the production subscription.

Write controls are independent. Gmail verifies the access token's actual mailbox against `QUIETER_LOCAL_GMAIL_WRITE_ACCOUNTS`. Calendar verifies the primary calendar against `QUIETER_LOCAL_CALENDAR_WRITE_ACCOUNTS`. Linear additionally requires `QUIETER_LOCAL_LINEAR_WRITES=true`. All require `QUIETER_LOCAL_PROVIDER_MODE=write`. Enabling Gmail tests alone leaves Calendar and Linear writes blocked.

### Reusing accounts across environments

The same Google account can connect to local, staging and production with separate OAuth clients, credentials, databases and Pub/Sub subscriptions. Each environment keeps its own sync cursor, AI results, app preferences and jobs. Google mail, labels, drafts, sent messages and calendars remain shared external data. Sending a message or marking it read locally changes the real mailbox visible in production.

Keep production as the watch owner while local and staging observe the same topic through their own subscriptions. Pub/Sub consumers on different subscriptions each receive a copy; consumers on the same subscription compete. Watch ownership and permission to modify mail are separate decisions. If a test account has no active production watch, explicitly hand watch renewal to local for that account before testing notifications.

For a temporary write handoff, first verify the other environment has stopped authorizing that account and its running jobs have drained. Then allow only the selected test address locally. Do not use the current Remove mailbox action as a pause: it deletes the mailbox row and cascades through saved app data. A mailbox already requiring reconnection can stay in production as a preserved record; do not reconnect it there during local write tests. Return local to observation mode before reconnecting production.

These controls do not implement a distributed ownership lock. Future staging needs the same default observation policy and an explicit shared ownership mechanism before automatic switching is safe. Merely setting a local flag does not pause production. Calendar ownership must be checked separately from Gmail because its credentials and automation are independent.

Google documents the [Gmail watch lifecycle](https://developers.google.com/workspace/gmail/api/guides/push) and [Pub/Sub subscription delivery](https://docs.cloud.google.com/pubsub/docs/subscription-overview).

## Development secrets

Keep AWS SSO selection in ignored `.env.sst.local`. The established stage is `local-leander`; use your own `local-<name>` stage for a different credential set.

```bash
vp run secrets:dev pull local-leander
vp run env:doctor
vp run dev:prepare
# After adding or rotating development credentials locally:
vp run secrets:dev push local-leander
```

The helper rejects production/fallback stages, verifies both database URLs, and suppresses secret values. SST is the persistent secret store; ignored `.env.local` and `.dev.vars` are runtime caches. The application and Worker caches never receive the migration URL from `dev:prepare`. The web bootstrap still reads `.env.local` to validate the migration destination, but application database access uses only `DATABASE_URL`.

## Polar and telemetry tests

Polar uses its existing sandbox catalog. Set `QUIETER_LOCAL_BILLING_BYPASS=false` to exercise checkout, credits and entitlements. Local customer/member external identifiers are prefixed with `local:`. New subscription metadata identifies the environment; local webhook processing ignores subscriptions without local metadata.

On this Windows machine, `vp run dev:polar` starts a WSL loopback relay on port 4300 and the official Polar CLI. Select Sandbox and the development organization. The relay forwards only `/api/auth/polar/webhooks` to Windows port 3000, preserving the signed bytes and signature headers. The distinct ports prevent WSL's automatic localhost forwarding from taking over the app's IPv4 port. It does not expose Vite, Local Explorer or other app routes. Install the [official Polar CLI](https://polar.sh/docs/integrate/webhooks/locally) in WSL first. Store its displayed signing secret as `PolarWebhookSecret` in your development SST stage, pull it, regenerate bindings and restart the app. On macOS/Linux, use `polar listen http://localhost:3000/api/auth/polar/webhooks` directly.

Sentry and PostHog default off. To test them, set `VITE_QUIETER_LOCAL_TELEMETRY=true` with development-project credentials, and `SENTRY_ENVIRONMENT=development` for server Sentry. PostHog still requires measurement consent and retains the privacy restrictions in code. No source-map upload token is needed locally. c15t remains in offline mode and supports consent accept/reject/revoke tests without a cloud service.

Cloudflare Local Explorer is available at `http://localhost:3000/cdn-cgi/local/explorer` for inspecting local resources and requests. It discovers configured bindings automatically. An empty resource list does not mean the application's background services are running.

Managed-mail fixture tests run on this machine:

```bash
vp run test:mail
```

For a mailbox in the running app, sign in locally, then run:

```bash
vp run dev:fixtures your-local-login@example.com
```

The command creates a private fixture mailbox in `quieter_dev` and prints its localhost URL. Its reserved `.test` address has no DNS records and cannot receive Internet mail. The background Worker writes the original MIME message to Wrangler's native R2 simulation. Both local runtimes share `.wrangler/state`, so attachments remain available after a restart. No remote bucket or R2 credential is required. Running the command again restores the raw fixture without duplicating the message. If you erase local storage, run it again.

The fixture endpoint requires the local Worker bearer token and rejects browser origins. Raw-message reads and deletes locally accept only the fixture storage namespace and `fixtures/` keys; copied production object references cannot reach remote storage.

The old `dev:mail` and AWS package `dev` commands were removed because they evaluated cloud infrastructure. Local development must not create mail domains, DNS records, SES identities, Lambda functions, SNS topics or remote mail buckets. Real managed-mail domain changes and external sending are blocked in the local application.

SES has no native local delivery service. Fixtures cover MIME, routing, request validation and feedback processing. They do not prove real MX routing, IAM permissions, SES delivery or cloud retries. Those are deployment-only checks, outside this local setup. SST Lambda Live still uses cloud resources and is not a local-only substitute. `dev:cloud` is only an alias for the Secret-linked local session described above.

## Where Changes Belong

| Change                                            | Location            |
| ------------------------------------------------- | ------------------- |
| Routes and application UI                         | `apps/web/src`      |
| Reusable UI components                            | `packages/ui`       |
| API procedures and database-backed business logic | `packages/orpc`     |
| Database schema and migrations                    | `packages/database` |
| Gmail REST integration                            | `packages/gmail`    |
| Pure MIME and mail parsing                        | `packages/mail`     |
| Better Auth configuration                         | `packages/auth`     |
| Billing plans and Polar integration               | `packages/billing`  |
| AI prompts, models, and generation                | `packages/ai`       |
| AWS handlers and workflows                        | `packages/aws`      |
| Environment schemas                               | `packages/env`      |

Application code must not access the database directly. Add or reuse an oRPC procedure instead. Application UI must consume reusable components through `@quieter/ui`.

## Database Changes

1. Edit `packages/database/src/schema.ts`.
2. Generate a migration:

   ```bash
   vp run db:generate
   ```

3. Review the SQL in `packages/database/drizzle`.
4. Test it:

   ```bash
   vp run db:check
   ```

CI runs destructive migration integration tests only against a dedicated temporary PostgreSQL database. Automated production migrations reject destructive SQL. Use expand/contract changes for renames, required columns, type rewrites, and destructive changes.

Read [Database safety](database-safety.md) before changing migration tooling.

## Testing and Quality

Run the full verification suite:

```bash
vp check --fix
vp test
vp run -r build
```

Useful focused commands:

```bash
vp test packages/orpc/tests/mailbox-service.test.ts
vp check apps/web
vp lint packages/database
vp run db:check
```

The pre-commit hook runs formatting and linting on staged files. Pull requests to `main` must pass the quality and migration checks.

## Generated Files

Do not hand-edit:

- `apps/web/src/routeTree.gen.ts`
- Drizzle migration snapshots, except when intentionally repairing generated history

## Working Style

- Keep changes inside established package boundaries.
- Preserve strict types; avoid `any`.
- Prefer TanStack Query for server state and TanStack Store for complex client-only workflows.
- Keep mailbox IDs in every mailbox-scoped query key and mutation path.
- Preserve existing layout and density for incremental UI changes.
- Remove obsolete paths in the same change instead of keeping compatibility branches.
- Update documentation when architecture, tooling, or operational behavior changes.
