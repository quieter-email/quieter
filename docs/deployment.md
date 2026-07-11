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

## Pull request previews

`.github/workflows/cloudflare-pr-preview.yml` deploys same-repository pull requests as isolated SST
stages named `pr-<number>`. Each stage publishes a Worker at
`https://pr-<number>.preview.quieter.email`. Closing the pull request removes the stage.

Fork pull requests do not receive Cloudflare credentials or Preview environment secrets. Do not use
`pull_request_target` to execute pull-request code. Preview deployments never run remote database
migrations. Keep preview credentials isolated and enable fake preview personas only in the GitHub
`Preview` environment.

## GitHub environment contract

The production environment must provide:

- deployment access: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, and
  `CLOUDFLARE_DEFAULT_ACCOUNT_ID`;
- database roles: `DATABASE_URL` and `DATABASE_MIGRATION_URL`;
- every runtime secret listed in `packages/env/src/github.ts`;
- Gmail notification, Polar catalog, R2, Sentry, PostHog, auth-mail, and public browser variables
  referenced by `.github/workflows/sst-deploy.yml`.

The Preview environment uses the same runtime contract with isolated non-production values. The
workflow calls `scripts/sync-sst-secrets.ts` immediately before deployment, so changing GitHub is
enough to update the next Worker release.

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
