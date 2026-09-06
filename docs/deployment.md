# Deployment

## Production

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual workflow dispatch. It calls `.github/workflows/ci-main.yml` as the same reusable verification workflow used by pull requests. SST is the source of truth for application runtime secrets; the protected GitHub `production` environment supplies deployment and operational credentials plus non-secret deployment configuration.

This is the legacy production path. The immutable release controller is being verified in isolated development stages and has not replaced it. The legacy path can change live resources before failing, rebuilds on rerun, and archives browser assets after activation. See [release development](release-development.md) for the implemented gates and remaining cutover requirements.

The release workflow:

1. runs type, lint, boundary, bundle, and test checks;
2. validates database migrations against a temporary PostgreSQL service;
3. checks the current release's legacy asset marker;
4. copies four GitHub-supplied values into SST, then applies committed forward-only production migrations;
5. runs `sst deploy` without application runtime secrets in the deploy process, deploying the AWS mail/background stack and the Cloudflare web Worker from SST-managed values;
6. wires SST resource outputs directly into the Worker and attaches `quieter.email`;
7. archives the client assets this release built so earlier tabs keep loading;
8. verifies the deployed web asset archive.

There is no separate hosting-provider build, deploy hook, or dashboard environment configuration. Cloudflare receives runtime variables and encrypted bindings from SST for each release. Generated resource URLs and names remain deployment outputs and are never copied into a second configuration store.

### Client asset retention

A deploy replaces the Worker asset manifest wholesale, so the previous release's hashed chunks stop resolving. A tab opened before the deploy then fails on its next lazy import, and because a missing asset falls through to the Worker it receives the HTML shell rather than JavaScript.

Each legacy release uploads `apps/web/dist/client/assets` to the `WebAssetArchive` R2 bucket via `vp run archive:web-assets`, reading the bucket name from the stack outputs written by `sst deploy`. The upload ends with a marker for that build. Before a later deployment may replace the Worker, `vp run verify:web-asset-archive` checks the currently served build ID and requires its marker to resolve through the archive. The marker records that the uploader reached its final step. It does not prove that every object still exists or has the expected bytes and MIME type. When the live manifest misses, the Worker attempts to serve the requested hashed file from the archive.

The first archive-aware release requires a manual `workflow_dispatch` run with `bootstrap_web_asset_archive` enabled because the preceding release has no plaintext build ID. This exception applies only to that explicitly authorized run; normal pushes fail closed. After bootstrap, a missing marker blocks a different release. A legacy workflow rerun rebuilds and redeploys before repairing the archive, so its stable build ID does not guarantee identical bytes. Inspect the active version and retain its build output before deciding how to repair a failed archive. The new controller archives verified artifacts before activation and repairs from those retained bytes.

Never delete objects from this bucket as part of a deploy: older tabs are reading from it. Prune it only through a retention policy chosen to outlive the longest realistic session, and only for objects no longer referenced by any recent release.

Asset retention covers loading, not protocol. An old client calling a server function whose shape has changed is a separate compatibility boundary, handled by expand/contract like any other. The client also compares its build id against `/assets/build-id.txt` and offers an explicit reload dialog when a chunk fails and the ids differ, which is the backstop for anything retention does not cover.

### Worker rollback and Durable Object versions

Roll back a production Worker by redeploying a known-good repository revision through the protected SST workflow. Do not deploy production Worker code with Wrangler or edit the Worker in the Cloudflare dashboard. Confirm that any database migration applied since that revision is compatible with the older application before rollback; otherwise ship a forward fix.

Treat Durable Object migration tags and lifecycle changes as compatibility boundaries. Deploy code that can safely communicate with both the preceding and succeeding object behavior, keep migration tags append-only, and verify object state before removing compatibility paths. Quieter does not use gradual deployments for the realtime Worker by default because each Durable Object instance is assigned to one Worker version and Durable Object migrations are applied atomically. A failed realtime release should be replaced through the same SST workflow with a compatible known-good or forward-fix revision.

## GitHub environment contract

The production environment must provide:

- deployment access: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_DEFAULT_ACCOUNT_ID`;
- migration access through `DATABASE_MIGRATION_URL`;
- operational credentials used outside deployed runtimes, including `SENTRY_AUTH_TOKEN`;
- Gmail notification, Polar catalog, R2, Sentry, PostHog, auth-mail, and public browser variables referenced by `.github/workflows/sst-deploy.yml`.

The Cloudflare web Worker reaches Postgres through Hyperdrive (`sst.cloudflare.Hyperdrive` `AppDatabase`), not a raw `DATABASE_URL` TCP pool. AWS mail/background functions still receive a `DATABASE_URL` runtime variable for compatibility, but its value comes from SST Secret rather than the deployment process environment.

Application secrets are cataloged in `packages/env/src/sst-secrets.ts` and declared in `infra/secrets.ts`. Set them through `vp exec sst secret set <Name> --stage <stage>`, supplying the value through stdin, then use the authorized infrastructure/configuration workflow to update bindings. The legacy production workflow still copies `CloudflareAccountId`, `CloudflareAiApiToken`, `DatabaseUrl`, and `PolarWebhookSecret` from GitHub into SST on each run. Removing these duplicate authorities remains part of the verified cutover; the billing binding must keep working through that transition. Non-sensitive configuration does not need to become a secret.

## Cloudflare dashboard verification

Repository checks cannot validate account-level state. After changing Worker infrastructure, verify that the deployment token remains least-privilege, logs and traces have the intended retention, Queues and their dead-letter queue are healthy, Hyperdrive targets the expected database with query caching disabled, and the production custom domain still routes to its intended Worker. Treat this as verification only; SST remains the configuration authority.

## Database safety

`DATABASE_URL` is the least-privilege runtime role. `DATABASE_MIGRATION_URL` is available only to the protected production migration step. Local development must use loopback Postgres or the explicitly allowlisted PlanetScale `quieter_dev` database. Keep `DATABASE_URL` on port 6432, set `DATABASE_MIGRATION_URL` to direct port 5432, and pin their exact host with `QUIETER_LOCAL_PLANETSCALE_HOST`. Do not store production migration credentials in `.env.local`.

Production migration history is never adopted or rewritten automatically. Automated production migrations reject destructive SQL; contract migrations require a separately reviewed manual procedure.

The `vector` extension must be enabled on a database before the memory-embedding migration runs against it. Neither the runtime role nor the migration role can create extensions, so enable it once per database through the PlanetScale control plane. Until it is enabled, the migration fails rather than silently shipping without semantic recall.

## Failure behavior

- Verification or migration failure prevents deployment.
- A failed SST deployment can already have changed live Workers or other resources. Inspect actual provider state before retrying or repairing; the stack is not a transaction.
- The release controller under development records pointer intent and supports separate-process recovery. It is currently restricted to isolated proof stages; production still uses the legacy workflow. See [release development](release-development.md).
