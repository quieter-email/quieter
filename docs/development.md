# Development

## Prerequisites

- Vite+ (`vp`), which manages the pinned Node runtime and Bun package manager
- Git
- PostgreSQL 16 or newer installed locally
- Non-production AWS credentials only when running the SST mail and background-processing stack
- OAuth and provider credentials for integrations you want to test

Hosted development databases are intentionally unsupported. Every developer uses local PostgreSQL,
and no developer receives production database credentials.

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

Do not copy production secrets into `.env.local`.
Run `vp run env:doctor` after editing `.env.local`; it fails if remote database URLs or
production-shaped provider keys are present.

## Local Database

Create an empty local database:

```bash
createdb quieter
```

The default example URL is:

```text
postgresql://postgres:postgres@localhost:5432/quieter
```

Adjust the username, password, or port for your local PostgreSQL installation. Keep the hostname
loopback-only.

Apply the committed application migrations:

```bash
vp run db:migrate
```

`db:push` is reserved for disposable local databases. Normal schema changes require a committed
Drizzle migration.

## Environment

Start with `.env.example`. Environment variables are validated by `@quieter/env`:

- `@quieter/env/client`: browser-visible `VITE_*` values
- `@quieter/env/public`: shared public values
- `@quieter/env/server`: web and package runtime values
- `@quieter/env/sst`: SST deployment requirements
- `@quieter/env/deployment`: production deployment requirements

Local development requires only the values needed by the paths you exercise. Important groups:

- `DATABASE_URL`: local PostgreSQL only
- Better Auth: application URL and secret
- Auth email mode: `QUIETER_AUTH_MAIL_MODE=console` prints local auth links without managed mail
- Google identity OAuth: sign-in only
- Google Gmail OAuth: separate client for mailbox authorization
- Gmail credential encryption keys
- OpenRouter: chat and mailbox AI features
- AWS and SST: managed mail, queues, workflows, and live synchronization
- Polar: checkout and subscription flows
- PostHog, Sentry, and logo.dev: optional integrations

Keep `DATABASE_MIGRATION_URL` unset locally. Local migration commands fall back to `DATABASE_URL`.

## Running

Run the normal local web session:

```bash
vp run dev
```

Vite Task starts `apps/web` on `http://localhost:3000`. This path does not start SST and should not
need AWS, R2, live-sync, or managed-mail provider credentials.

Run the optional mail and background-processing stack only when you need it:

```bash
vp run dev:mail
```

Run both sessions together with `vp run dev:all`. The SST wrapper defaults to the `mail-dev`
stage and loads `.env.local` plus optional `.env.sst.local`. Keep AWS credentials out of
`.env.local`; put non-production SST credentials in `.env.sst.local` when the mail stack is needed.

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

Application code must not access the database directly. Add or reuse an oRPC procedure instead.
Application UI must consume reusable components through `@quieter/ui`.

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

CI runs destructive migration integration tests only against a dedicated temporary PostgreSQL
database. Automated production migrations reject destructive SQL. Use expand/contract changes for
renames, required columns, type rewrites, and destructive changes.

Read [Database safety](database-safety.md) before changing migration tooling.

## Testing and Quality

Run the full verification suite:

```bash
vp check --fix
vp run check:copy
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

The pre-commit hook runs formatting and linting on staged files. Pull requests to `main` must pass
the quality and migration checks.

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
