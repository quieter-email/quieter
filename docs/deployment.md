# Deployment

## Production

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual
workflow dispatch. The protected GitHub `production` environment is the only manually configured
source of deployment variables and secrets.

The release workflow:

1. runs type, lint, copy, boundary, bundle, and test checks;
2. validates database migrations when database inputs changed;
3. applies committed forward-only production migrations;
4. synchronizes GitHub secrets into SST's encrypted secret store;
5. runs `sst deploy`, which deploys the AWS mail/background stack and the Cloudflare web Worker;
6. wires SST resource outputs directly into the Worker and attaches `quieter.email`;
7. invokes the authenticated Gmail credential rotation endpoint.

There is no separate hosting-provider build, deploy hook, or dashboard environment configuration.
Cloudflare receives runtime variables and encrypted bindings from SST for each release. Generated
resource URLs and names remain deployment outputs and are never copied into a second configuration
store.

## Review environment

Pull request review is opt-in. `.github/workflows/review-deploy.yml` accepts a same-repository pull
request number, resolves its current head to an exact commit SHA, verifies that revision without
secrets, and promotes it to the single SST `review` stage at
`https://review.quieter.email`. A later promotion replaces the previous revision.

The workflow runs only by manual dispatch from the default branch. It is not triggered by pull
request events, is not a required check, and does not change branch protection, so merging never
waits for a review deployment. Fork pull requests cannot be promoted. Do not use
`pull_request_target` to execute pull-request code and do not recreate dynamic `pr-*` stages.

The stable origin makes provider configuration conventional and auditable. Its Google redirect URLs
are exact, fixed values:

- identity sign-in: `https://review.quieter.email/api/auth/callback/google`;
- Gmail authorization: `https://review.quieter.email/api/gmail/callback`;
- Google Calendar authorization: `https://review.quieter.email/api/connectors/callback`.

The Review environment has a dedicated Cloudflare deployment token, OAuth clients, encryption
keys, and synthetic non-production database role. It has no production mail, billing, AI, storage,
or migration credentials. The Google OAuth project remains in testing mode and lists the permitted
reviewers explicitly. Shared Review deployments disable preview personas, while Better Auth permits
first-time Google signup only in Review so an approved test user can enter through the fixed
callback. Review deployments never run remote database migrations.

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

The Review environment provides only `BETTER_AUTH_SECRET`, `CLOUDFLARE_API_TOKEN`,
`CONNECTOR_TOKEN_ENCRYPTION_KEY`, `DATABASE_URL`, both Gmail token-encryption keys, and the three
Google OAuth client pairs, plus the non-secret Cloudflare account id and app display variables. The
workflow calls `scripts/sync-sst-secrets.ts` immediately before deployment, so changing GitHub is
enough to update the next promoted release.

## Database safety

`DATABASE_URL` is the least-privilege runtime role. `DATABASE_MIGRATION_URL` is available only to the
protected production migration step. Local development must use local Postgres and must not store a
remote migration credential in `.env.local`.

Production migration history is never adopted or rewritten automatically. Automated production
migrations reject destructive SQL; contract migrations require a separately reviewed manual
procedure.

## Failure behavior

- Verification or migration failure prevents deployment.
- Secret synchronization failure prevents deployment.
- SST failure leaves the previous Worker release serving traffic.
- Gmail credential rotation runs only after SST reports a successful production deployment.
