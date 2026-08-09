# Development

## Prerequisites

- Vite+ (`vp`), which manages the pinned Node runtime and Bun package manager
- Git
- PostgreSQL 16 or newer locally, or a dedicated disposable Neon development branch
- Non-production AWS credentials only when running the SST mail and background-processing stack
- OAuth and provider credentials for integrations you want to test

Local PostgreSQL remains supported. A dedicated Neon development branch is also supported when its exact direct endpoint hostname is pinned with `QUIETER_LOCAL_NEON_HOST`; arbitrary hosted or production database URLs remain rejected.

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

## Local Database

Create an empty local database:

```bash
createdb quieter
```

The default example URL is:

```text
postgresql://postgres:postgres@localhost:5432/quieter
```

Adjust the username, password, or port for your local PostgreSQL installation. Keep the hostname loopback-only.

For a disposable Neon branch, use its pooled connection string for `DATABASE_URL`, its direct connection string for `DATABASE_MIGRATION_URL`, and pin the direct hostname:

```text
DATABASE_URL=postgresql://user:password@ep-your-development-branch-pooler.region.aws.neon.tech/neondb
DATABASE_MIGRATION_URL=postgresql://user:password@ep-your-development-branch.region.aws.neon.tech/neondb
QUIETER_DEPLOYMENT_ENV=local
QUIETER_LOCAL_NEON_HOST=ep-your-development-branch.region.aws.neon.tech
```

The local guards normalize pooled and direct Neon hostnames but accept only that exact endpoint. `DATABASE_MIGRATION_URL` is required for Neon and must use the direct endpoint. Never point the allowlist at a production branch.

Apply the committed application migrations:

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

- `DATABASE_URL`: loopback PostgreSQL or the explicitly allowlisted Neon development branch (pooled)
- `DATABASE_MIGRATION_URL`: required for Neon as the direct endpoint; optional on loopback, where migration commands fall back to `DATABASE_URL`
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
bun run dev
```

This directly starts the Cloudflare/Vite production-shaped Worker runtime on `http://localhost:3000` as the only foreground process. Vite validates that the database is loopback-only or the explicitly allowlisted Neon branch before serving. Chat generation, AI automation, and mailbox actions use their in-process fallbacks, so stopping this command stops all local background work without a custom orchestrator. Apply migrations explicitly with `vp run db:migrate` after pulling or generating schema changes.

Run the optional remote mail and background-processing infrastructure only for explicit provider integration tests:

```bash
bun run dev:mail
```

`bun run dev` is the single safe local runtime. Use `bun run dev:cloud` when you explicitly need the web app and SST together. The package commands invoke SST directly with the `mail-dev` stage and load `.env.local` plus optional `.env.sst.local`. Keep AWS credentials out of `.env.local`; put non-production SST credentials in `.env.sst.local`. Remote queues and schedules can outlive the terminal, so remove the stage after infrastructure testing rather than relying on Ctrl+C.

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
