# Deployment and Operations

## Release Model

Production is not deployed from an ordinary push.

1. Changes reach protected `main` through a reviewed pull request.
2. Required CI checks verify formatting, linting, types, tests, schema drift, and migrations.
3. A maintainer manually dispatches `.github/workflows/sst-deploy.yml`.
4. The protected GitHub `production` environment requires approval.
5. Forward database migrations run with the deployment-only migration role.
6. SST updates infrastructure.
7. SST outputs are synchronized to Vercel.
8. The Vercel production deploy hook is triggered and monitored.
9. The Gmail credential rotation endpoint runs.

`vercel.json` disables commit-triggered deployments.

## Database Credentials

Production uses separate roles:

- `DATABASE_URL`: least-privilege runtime role used by Vercel and SST functions
- `DATABASE_MIGRATION_URL`: schema-owner role stored only in the protected GitHub environment

Remote migrations are rejected unless they run in the protected `main` GitHub Actions context with
the workflow-only production marker. Runtime requests do not execute schema migrations.

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
bun run sst secret set MailSendToken <value>
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
- Production environment approval is expected and assigned.
- Provider quotas and billing configuration are understood.
- A recovery point exists before risky schema or infrastructure work.
