# Deployment

## Production

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual workflow dispatch. It calls `.github/workflows/ci-main.yml` as the same reusable verification workflow used by pull requests. SST is the source of truth for application runtime secrets; the protected GitHub `production` environment supplies deployment and operational credentials plus non-secret deployment configuration.

The release workflow:

1. runs type, lint, boundary, bundle, and test checks;
2. validates database migrations against a temporary PostgreSQL service;
3. applies committed forward-only production migrations;
4. loads application secrets directly from SST's encrypted secret store;
5. runs `sst deploy` without application runtime secrets in the deploy process, deploying the AWS mail/background stack and the Cloudflare web Worker from SST-managed values;
6. wires SST resource outputs directly into the Worker and attaches `quieter.email`;
7. archives the client assets this release built so earlier tabs keep loading;
8. invokes the authenticated Gmail credential rotation endpoint.

There is no separate hosting-provider build, deploy hook, or dashboard environment configuration. Cloudflare receives runtime variables and encrypted bindings from SST for each release. Generated resource URLs and names remain deployment outputs and are never copied into a second configuration store.

### Client asset retention

A deploy replaces the Worker asset manifest wholesale, so the previous release's hashed chunks stop resolving. A tab opened before the deploy then fails on its next lazy import, and because a missing asset falls through to the Worker it receives the HTML shell rather than JavaScript.

Each release therefore uploads `apps/web/dist/client/assets` to the `WebAssetArchive` R2 bucket via `pnpm run archive:web-assets`, reading the bucket name from the stack outputs written by `sst deploy`. When the live manifest misses, the Worker serves the chunk from that archive, so tabs opened before a release keep working untouched and pick up the new build on their next navigation.

Never delete objects from this bucket as part of a deploy: older tabs are reading from it. Prune it only through a retention policy chosen to outlive the longest realistic session, and only for objects no longer referenced by any recent release.

Asset retention covers loading, not protocol. An old client calling a server function whose shape has changed is a separate compatibility boundary, handled by expand/contract like any other. The client also compares its build id against `/assets/build-id.txt` and reloads when a chunk fails and the ids differ, which is the backstop for anything retention does not cover.

### Worker rollback and Durable Object versions

Roll back a production Worker by redeploying a known-good repository revision through the protected SST workflow. Do not deploy production Worker code with Wrangler or edit the Worker in the Cloudflare dashboard. Confirm that any database migration applied since that revision is compatible with the older application before rollback; otherwise ship a forward fix.

Treat Durable Object migration tags and lifecycle changes as compatibility boundaries. Deploy code that can safely communicate with both the preceding and succeeding object behavior, keep migration tags append-only, and verify object state before removing compatibility paths. Quieter does not use gradual deployments for the realtime Worker by default because each Durable Object instance is assigned to one Worker version and Durable Object migrations are applied atomically. A failed realtime release should be replaced through the same SST workflow with a compatible known-good or forward-fix revision.

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

- Verification or migration failure prevents deployment.
- A failed production deployment leaves the previous Worker release serving traffic.
- Gmail credential rotation runs only after SST reports a successful production deployment.
