# Deployment

## Production

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual workflow dispatch. It calls `.github/workflows/ci-main.yml` as the same reusable verification workflow used by pull requests. SST is the source of truth for application runtime secrets; the protected GitHub `production` environment supplies deployment and operational credentials plus non-secret deployment configuration.

The release workflow runs the existing CI checks, runs `sst diff` to create the production web build, refreshes SST state, then runs `sst diff` again to prepare against the refreshed state. The first build is required on fresh runners because the Cloudflare provider reads the recorded asset directory during refresh, before SST can create it. Both builds use SST-resolved configuration, and source-map upload must succeed during preparation. Neither `diff` nor `refresh` publishes the new Worker.

`sst deploy` reuses the prepared web output. A local SHA-256 receipt verifies every output file, the build ID and the generated SST Wrangler configuration. Changed or missing output fails closed. The receipt and generated Wrangler files can contain configuration and must never be uploaded as public artifacts. There is no R2 asset archive.

Preparation completes before migrations or runtime updates. Migrations remain forward-only and expand-safe. Deploys must keep the previous application's database queries, API calls and queued-message formats valid. Add fields before using them, keep readers tolerant of older messages, and remove old contracts in a later reviewed change. The PostgreSQL parser classifies new migrations against a conservative additive allowlist: new tables and enum types, nullable columns without defaults, non-unique indexes, relaxed nullability, and constraint validation. Constraints and unique indexes are accepted for tables created in the same migration. Other operations need a separate contract review; the gate cannot prove application compatibility or acceptable lock duration. Existing migration history is accepted only with the recorded checksums in `packages/database/scripts/historical-migrations.json`; do not add new migrations to that manifest. Non-transactional migrations must contain only concurrent indexes. A `quieter:contract` comment does not bypass the guard for new or modified migrations.

After SST finishes, `scripts/check-deployment.ts` verifies the server build ID, a read-only database query, the static build marker, server-rendered `/about` HTML, and its JavaScript/CSS assets. The public `/api/health` endpoint returns only a build ID and health status, caches successful database checks for 30 seconds per isolate, and bounds database statements to two seconds. It never returns credentials or user data. A failed check fails the release workflow.

Open tabs check the build marker on focus and every minute while visible. A different build opens the reload dialog; the user decides when to reload. Network failures do not claim a new version exists, and no automatic reload occurs. Existing tabs still require backend compatibility until they reload.

### Web recovery

Before changing production, the workflow records the currently healthy web Worker version in the private `previous-web` GitHub artifact, retained for 90 days. The first deployment introducing build markers and health checks has no verified predecessor and therefore no recovery record. Later deployments fail before mutation if the existing marked release is unhealthy; repair the release or recover it before continuing.

For a compatible web-only failure, run **Recover Web Release** on `main`:

1. Select the deployment run ID that recorded the previous healthy version.
2. Inspect the web Worker's current active version UUID in Cloudflare and enter it.
3. Confirm that restoring the previous web code is compatible with the current database, bindings and background jobs.

The workflow uses the protected production environment and the same concurrency group as deployments. It verifies the artifact came from a completed production workflow on `main`, checks the domain's Worker and expected active version, restores the recorded version through Cloudflare, and reruns health checks. No Git history changes or database rollback occur. It is intentionally manual; smoke-test failure does not authorize an infrastructure rollback.

Do not use this button after incompatible schema, binding, Durable Object, queue or background-job changes. Use a reviewed forward fix through SST. Cloudflare can refuse version rollback when dependent resources changed. If restoration succeeds but checks fail, inspect the live state before retrying. The next normal deployment always runs `sst refresh` before planning, reconciling emergency provider changes with SST state. A recovered web release does not establish that background jobs are healthy.

### Local verification

Run `vp check --fix`, `vp test`, and the existing web/handler build checks. `vp exec node scripts/check-deployment.ts <origin> <build-id>` also works against a running local Worker with development bindings. Keep production credentials out of local files. Live production deployment and recovery run only through the protected workflows; unit tests simulate provider failures and artifact tampering without touching production.

## GitHub environment contract

The production environment must provide:

- deployment access: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_DEFAULT_ACCOUNT_ID`;
- migration access through `DATABASE_MIGRATION_URL`;
- operational credentials used outside deployed runtimes, currently `GMAIL_CREDENTIAL_ROTATION_TOKEN` and `SENTRY_AUTH_TOKEN`;
- Gmail notification, Polar catalog, R2, Sentry, PostHog, auth-mail, and public browser variables referenced by `.github/workflows/sst-deploy.yml`.

The Cloudflare web Worker reaches Postgres through Hyperdrive (`sst.cloudflare.Hyperdrive` `AppDatabase`), not a raw `DATABASE_URL` TCP pool. AWS mail/background functions still receive a `DATABASE_URL` runtime variable for compatibility, but its value comes from SST Secret rather than the deployment process environment.

Application secrets are cataloged in `packages/env/src/sst-secrets.ts` and declared in `infra/secrets.ts`. Set or rotate them with `sst secret set <Name> <Value> --stage <stage>`, then deploy that stage so runtimes receive the updated value. The production workflow does not copy application secrets from GitHub; `sst deploy` receives only provider credentials, operational/build-only credentials such as the migration and Sentry source-map tokens, and non-secret configuration. Non-sensitive configuration does not need to become a secret.

## Cloudflare dashboard verification

Repository checks cannot validate account-level state. After changing Worker infrastructure, verify that the deployment token remains least-privilege, logs and traces have the intended retention, Queues and their dead-letter queue are healthy, Hyperdrive targets the expected database with query caching disabled, and the production custom domain still routes to its intended Worker. Treat this as verification only; SST remains the configuration authority.

## Database safety

`DATABASE_URL` is the least-privilege runtime role. `DATABASE_MIGRATION_URL` is available only to the protected production migration step. Local development must use loopback Postgres or the explicitly allowlisted PlanetScale `quieter_dev` database. Keep `DATABASE_URL` on port 6432, set `DATABASE_MIGRATION_URL` to direct port 5432, and pin their exact host with `QUIETER_LOCAL_PLANETSCALE_HOST`. Do not store production migration credentials in `.env.local`.

Production migration history is never adopted or rewritten automatically. Automated production migrations reject destructive SQL; contract migrations require a separately reviewed manual procedure.

The `vector` extension must be enabled on a database before the memory-embedding migration runs against it. Neither the runtime role nor the migration role can create extensions, so enable it once per database through the PlanetScale control plane. Until it is enabled, the migration fails rather than silently shipping without semantic recall.

## Failure behavior

A preparation failure prevents migrations and runtime updates. A migration failure stops SST deployment, but earlier migrations may already have committed. An SST failure can leave some resources updated. Smoke checks detect a broken published web release but cannot undo its effects. Keep adjacent releases compatible and use the recovery procedure above where applicable. This workflow does not make the entire AWS/Cloudflare stack transactional.
