# Deployment and Operations

## Release Model

Production is not deployed from Vercel git pushes.

1. Changes reach protected `main` through a reviewed pull request.
2. Required CI checks verify formatting, linting, types, tests, schema drift, and migrations.
3. Merging to `main` triggers `.github/workflows/sst-deploy.yml`. Maintainers can also dispatch it manually.
4. Forward database migrations run with the deployment-only migration role.
5. SST updates infrastructure.
6. SST outputs are synchronized to Vercel.
7. The Vercel production deploy hook is triggered and monitored.
8. The Gmail credential rotation endpoint runs.

`vercel.json` disables commit-triggered deployments.

## Staging

Staging deploys from `main` through `.github/workflows/staging-deploy.yml`.
The workflow verifies the repo, applies migrations to the staging database, pulls Vercel Preview
environment variables scoped to the `staging` Git branch in Vercel, builds the app, and uploads a Vercel Preview
deployment with the Vercel CLI. It does not deploy SST, AWS, Cloudflare, or managed-mail
infrastructure.

The GitHub `staging` environment needs:

- `DATABASE_MIGRATION_URL`: staging database schema-owner URL, never production
- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID`

Configure Vercel preview env vars separately from production. At minimum staging needs
`DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `APP_SITE_PASSWORD`, and any provider
credentials for features being tested. Leave production-only mail/live-sync variables unset unless a
separate staging stack exists.

Gmail AI automation is disabled outside Vercel production unless
`QUIETER_GMAIL_AI_AUTOMATION_ENABLED=true` is set. Keep it unset or false for ordinary staging and
preview deployments; enable it only for controlled tests with isolated provider keys and low
provider-side spend caps.

## Pull Request Previews

`.github/workflows/vercel-pr-preview.yml` creates Vercel Preview deployments for trusted pull
requests whose source branch is in this repository. The workflow pulls the Vercel Preview variables
scoped to the `staging` branch so preview builds use the same isolated non-production service
credentials as staging without copying them into generic Preview scope. Fork pull requests run
normal checks but do not receive Vercel tokens or preview environment secrets, because arbitrary
contributor code can exfiltrate any secret available during a build or runtime preview.

The GitHub `preview` environment needs `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, and `VERCEL_TEAM_ID`
or `VERCEL_ORG_ID`. Configure Vercel Preview environment variables with non-production values only.
Do not put production databases, production OAuth clients, production mail credentials, production
provider keys, or production billing tokens in the generic Preview environment. Branch-specific
preview variables may be used for trusted long-lived branches such as `staging`.

## Database Credentials

Production uses separate roles:

- `DATABASE_URL`: least-privilege runtime role used by Vercel and SST functions
- `DATABASE_MIGRATION_URL`: schema-owner role stored only in the protected GitHub environment

Remote production migrations are rejected unless they run in the protected `main` GitHub Actions
context with the workflow-only production marker. Remote staging migrations are accepted only from
the `main` branch staging workflow with the staging marker. Runtime requests do not execute schema
migrations.

See [Database safety](database-safety.md) for role SQL and recovery controls.

## GitHub Production Environment

The production environment contains:

- AWS deployment role and region
- database runtime and migration URLs
- Gmail OAuth and notification configuration
- Gmail credential encryption keys and rotation token
- OpenRouter and Polar credentials
- Vercel token, project/team IDs, and deploy hook URL

The exact authoritative list is the `deploy` job in `.github/workflows/sst-deploy.yml`.

Never copy production environment secrets to a developer machine.

## SST Secrets

Mail bearer tokens and workflow authentication values are SST linked secrets. Use the repository
wrapper so the correct config, stage, and local AWS environment are applied:

```bash
bun run sst secret set MailIngestToken <value>
bun run sst secret set ChatGenerationStartToken <value>
bun run sst secret set GmailLiveSyncTokenSecret <value>
```

The wrapper defaults to the `mail-dev` stage. Specify `--stage production` deliberately when
managing production secrets.

## Gmail Notifications

Production requires a Gmail topic, authenticated push subscription, push service account, and exact
audience configuration. SST owns the stable ingress domain and queue handoff.

Gmail notifications can be delayed or dropped, so scheduled reconciliation and browser polling must
remain enabled even when push is configured.

## Managed Mail

The deploy creates and exports:

- inbound S3 bucket
- SES receipt topic and role
- receipt rule-set name
- inbound and outbound function URLs

SES receipt rules and domain DNS remain external operational configuration. Do not expose provider
or infrastructure names in user-facing product copy.

## Failure Behavior

- Production concurrency does not cancel an in-progress deployment.
- Database migrations run before infrastructure and web changes.
- Committed migrations are forward-only; production history is never automatically adopted or
  rewritten.
- SST resources are protected and retained in production.
- A failed Vercel deployment fails the workflow.

## Recovery

- Keep the Neon production branch protected.
- Configure the longest affordable restore window.
- Test point-in-time recovery periodically.
- Rotate credentials after suspected exposure.
- Preserve application logs and GitHub run URLs during incidents.
- Restore into a separate branch or recovery target before replacing production.

## Pre-Release Checklist

- Pull request is approved and required checks pass.
- Migration SQL is reviewed and expand-safe.
- Runtime and migration credentials remain separate.
- Provider quotas and billing configuration are understood.
- A recovery point exists before risky schema or infrastructure work.
