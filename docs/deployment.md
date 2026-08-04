# Deployment

## Production

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual
workflow dispatch. It calls `.github/workflows/ci-main.yml` as the same reusable verification
workflow used by pull requests. The protected GitHub `production` environment is the only manually
configured source of deployment variables and secrets.

The release workflow:

1. runs type, lint, copy, boundary, bundle, and test checks;
2. validates database migrations against a temporary PostgreSQL service;
3. applies committed forward-only production migrations;
4. synchronizes GitHub secrets into SST's encrypted secret store;
5. runs `sst deploy`, which deploys the AWS mail/background stack and the Cloudflare web Worker;
6. wires SST resource outputs directly into the Worker and attaches `quieter.email`;
7. invokes the authenticated Gmail credential rotation endpoint.

There is no separate hosting-provider build, deploy hook, or dashboard environment configuration.
Cloudflare receives runtime variables and encrypted bindings from SST for each release. Generated
resource URLs and names remain deployment outputs and are never copied into a second configuration
store.

### Worker rollback and Durable Object versions

Roll back a production Worker by redeploying a known-good repository revision through the protected
SST workflow. Do not deploy production Worker code with Wrangler or edit the Worker in the
Cloudflare dashboard. Confirm that any database migration applied since that revision is compatible
with the older application before rollback; otherwise ship a forward fix.

Treat Durable Object migration tags and lifecycle changes as compatibility boundaries. Deploy code
that can safely communicate with both the preceding and succeeding object behavior, keep migration
tags append-only, and verify object state before removing compatibility paths. Quieter does not use
gradual deployments for the realtime Worker by default because each Durable Object instance is
assigned to one Worker version and Durable Object migrations are applied atomically. A failed
realtime release should be replaced through the same SST workflow with a compatible known-good or
forward-fix revision.

## Review environment

Pull request review is opt-in. When `leanderriefel` posts the exact comment `quieter review` on an
open same-repository pull request, `.github/workflows/review-deploy.yml` resolves its current head to
an exact commit SHA, verifies that revision without secrets, builds a credential-free Worker
artifact, and promotes it to the single review Worker at `https://review.quieter.email`. The command
receives a rocket reaction when accepted. A later promotion replaces the previous revision. An
owner-only manual dispatch remains available as an operational fallback.

The comment author is checked by both the exact GitHub login and immutable GitHub user id. Other
comments do nothing, including the same command from another account. The command is the deployment
authorization signal, so promotion does not require a second environment approval. The workflow is
not a required check and does not change branch protection, so merging never waits for a review
deployment. Fork pull requests cannot be promoted. Do not use `pull_request_target` to execute
pull-request code and do not recreate dynamic `pr-*` stages or provider-generated preview URLs.

The credential boundary is structural: all pull-request commands run in the verification job with
no deployment or runtime secrets. That job uploads only a pre-bundled Worker and static assets. The
environment-scoped promotion job checks out the workflow's trusted default-branch revision,
validates the artifact shape and size, and uploads it with the pinned Wrangler version and the
repository-owned `.github/review-worker.wrangler.jsonc`. The Cloudflare token exists only in that
final upload step; pull-request package scripts, build tools, and configuration never receive it.

The stable origin makes provider configuration conventional and auditable. Its Google redirect URLs
are exact, fixed values:

- identity sign-in: `https://review.quieter.email/api/auth/callback/google`;
- Gmail authorization: `https://review.quieter.email/api/gmail/callback`;
- Google Calendar authorization: `https://review.quieter.email/api/connectors/callback`.

The Review environment has a dedicated least-privilege Cloudflare deployment token. The Worker has
dedicated OAuth clients, encryption keys, and a Hyperdrive binding to a synthetic non-production
database; the raw database credential is not a Worker environment variable. It has no production
mail, billing, AI, or storage credentials. Approved pull-request code necessarily runs with the
isolated Review runtime bindings, so reviewers must use only dedicated test mailboxes and must
never connect a personal or production Gmail mailbox. The Google OAuth project remains in testing
mode and lists the permitted reviewers explicitly. Shared Review deployments disable preview
personas, while Better Auth permits first-time Google signup only in Review so an approved test
user can enter through the fixed callback. The trusted deploy job applies the promoted revision's
committed expand migrations to the synthetic Review database before the health probe, using a
Review-only `DATABASE_MIGRATION_URL`. The first Review deploy for a pull request wipes the
Review schemas and replays that revision's migrations; later deploys of the same pull request
only apply new migrations so review data can survive pushes.

## GitHub environment contract

The production environment must provide:

- deployment access: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, and
  `CLOUDFLARE_DEFAULT_ACCOUNT_ID`;
- database roles: `DATABASE_URL` and `DATABASE_MIGRATION_URL`;
- every runtime secret listed in `packages/env/src/github.ts`;
- Gmail notification, Polar catalog, R2, Sentry, PostHog, auth-mail, and public browser variables
  referenced by `.github/workflows/sst-deploy.yml`.

The Cloudflare web Worker reaches Postgres through Hyperdrive (`sst.cloudflare.Hyperdrive`
`AppDatabase`), not a raw `DATABASE_URL` TCP pool. AWS mail/background functions still use
`DATABASE_URL` directly.

The GitHub Review environment provides `CLOUDFLARE_API_TOKEN`, the Review-only
`DATABASE_MIGRATION_URL`, and the non-secret `CLOUDFLARE_DEFAULT_ACCOUNT_ID`. Runtime OAuth client
secrets and encryption keys live only as encrypted bindings on the isolated Review Worker.
Non-secret Worker configuration, OAuth client ids, the fixed domain, and the Review Hyperdrive id
are source-controlled in `.github/review-worker.wrangler.jsonc`. Rotate runtime secrets directly on
the Review Worker; do not copy them into pull-request jobs or source control.

## Cloudflare dashboard verification

Repository checks cannot validate account-level state. After changing Worker infrastructure, verify
that the deployment token remains least-privilege, logs and traces have the intended retention,
Queues and their dead-letter queue are healthy, Hyperdrive targets the expected database with query
caching disabled, and production and Review custom domains still route to their intended Workers.
Treat this as verification only; SST and the repository-controlled Review workflow remain the
configuration authorities.

## Database safety

`DATABASE_URL` is the least-privilege runtime role. `DATABASE_MIGRATION_URL` is available only to the
protected production migration step. Local development must use loopback Postgres or an explicitly
allowlisted disposable Neon branch. For Neon, keep `DATABASE_URL` pooled and set
`DATABASE_MIGRATION_URL` to the matching direct endpoint pinned by `QUIETER_LOCAL_NEON_HOST`. Do not
store production migration credentials in `.env.local`.

Production migration history is never adopted or rewritten automatically. Automated production
migrations reject destructive SQL; contract migrations require a separately reviewed manual
procedure.

## Failure behavior

- Verification or migration failure prevents deployment.
- Artifact validation or protected promotion failure leaves the previous Review Worker release
  serving traffic.
- Gmail credential rotation runs only after SST reports a successful production deployment.
