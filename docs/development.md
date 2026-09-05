# Development

## Prerequisites

- Vite+ (`vp`), which manages the pinned Node runtime and dependency installs
- Git
- Access to the allowlisted PlanetScale `quieter_dev` logical database
- Non-production AWS credentials only when running the SST mail and background-processing stack
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
- AWS and SST: optional provider-infrastructure integration tests only
- Polar: checkout and subscription flows
- PostHog, Sentry, and logo.dev: optional integrations

## Running

Run the normal local web session:

```bash
vp run dev
```

This starts the web app in Cloudflare's local Worker runtime on `http://localhost:3000`. Vite validates the development database destination before serving. The current local configuration does not start the background queue consumers, maintenance jobs, or realtime Durable Object. Interactive chat can run in the web request, but that does not establish background automation coverage. Native Cloudflare auxiliary Workers and their bindings still need wiring; see the integration plan.

Cloudflare Local Explorer is available at `http://localhost:3000/cdn-cgi/local/explorer` for inspecting local resources and requests. It discovers configured bindings automatically. An empty resource list does not mean the application's background services are running.

Run the optional remote mail and background-processing infrastructure only for explicit provider integration tests:

```bash
vp run dev:mail
```

The package command invokes SST with the `mail-dev` stage and loads `.env.local` plus optional `.env.sst.local`. Despite its name, `dev:mail` evaluates the full infrastructure app. It requires a reviewed development-stage configuration and must not be used as an offline emulator. Prefer an AWS SSO profile over persistent credentials in environment files.

The current `dev:cloud` script also starts a separate web process. SST's TanStack Start component manages its own frontend process and linked environment, so startup ownership and the explicit Vite+ dev command need correction before treating this as the complete development entrypoint. Remote resources can outlive the terminal; manage their lifecycle through the intended SST stage.

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
