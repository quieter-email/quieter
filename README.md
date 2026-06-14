# Quieter

Private/experimental email client with Gmail and organization-managed SES mailboxes. **Deep alpha, very work-in-progress, many gaps and TODOs. Not recommended for use.**

This repo is published under the MIT license (see `LICENSE`). **We do not accept contributions.** **Do not open issues here.**

For internal maintainer notes, see `AGENTS.md`.

## Stack

- Bun, Turborepo, SST
- Web: TanStack Start, TanStack Router, React, Vite, Nitro
- Forms/state: TanStack Form, TanStack Query, TanStack Store, TanStack Hotkeys
- API: oRPC
- DB: Drizzle, Postgres
- UI: Tailwind CSS 4, Tiptap, shadcn/ui base with Base UI, Vaul, Sonner and Hugeicons
- Tooling: Oxlint, Oxfmt, `tsgo`

## Environment

Copy `.env.example` to `.env.local` for local development. `@quieter/env` validates and
normalizes configuration with T3 Env:

- `@quieter/env/client` accepts Vite's `import.meta.env` and exposes only declared `VITE_*` values.
- `@quieter/env/public` contains public values needed by shared packages.
- `@quieter/env/server` owns application runtime values and typed defaults.
- `@quieter/env/sst` and `@quieter/env/deployment` enforce deployment-specific requirements.

The package is compiled before Vite loads its Node-based config. Turbo tracks `.env*` as global
inputs and declares task-visible variables in `turbo.json`; add new variables to both the relevant
schema and Turbo task when they affect a build or dev process.

## Gmail Pub/Sub

Pro Gmail mailboxes use an authenticated Google Cloud Pub/Sub push subscription. Gmail push is a
wake-up signal rather than a complete event log, so the backend persists a Gmail history cursor,
fans maintenance out through a FIFO queue every 15 minutes, renews every watch daily, and
reconciles history independently per mailbox. Push requests are acknowledged only after the same
queue accepts them.

Focused browser tabs receive the wake-up signal through an SST-managed API Gateway WebSocket.
API Gateway owns the connection; Lambda runs only for connect, disconnect, keepalive, and delivery.
Connection IDs live in a TTL-backed DynamoDB table. The browser reconnects with a short-lived,
mailbox-scoped credential, runs the existing Gmail history sync after every signal, and keeps the
existing foreground poll as the missed-event fallback. Set `GmailLiveSyncTokenSecret` through SST
and use the same value for `GMAIL_LIVE_SYNC_TOKEN_SECRET` in the web app:

```bash
export GMAIL_LIVE_SYNC_TOKEN_SECRET="$(openssl rand -base64 48)"
bun run sst secret set GmailLiveSyncTokenSecret "$GMAIL_LIVE_SYNC_TOKEN_SECRET" --stage production
```

Production deploys sync `gmailLiveSyncUrl` to Vercel as `GMAIL_LIVE_SYNC_URL`. For local development,
copy that stage output into `.env.local` with the same live-sync token secret.

AI auto-labeling is a separate per-mailbox opt-in. It considers the mailbox's existing custom Gmail
labels, using each persisted description and inclusion criteria when present and otherwise inferring
from the label name. The worker only applies current Gmail label IDs and never creates labels.

Create the topic in the same Google Cloud project as the dedicated Gmail OAuth client, then grant
Gmail permission to publish:

```bash
gcloud pubsub topics create quieter-gmail
gcloud pubsub topics add-iam-policy-binding quieter-gmail \
  --member="serviceAccount:gmail-api-push@system.gserviceaccount.com" \
  --role="roles/pubsub.publisher"
```

Create a push-auth service account and allow the Pub/Sub service agent to mint its OIDC tokens:

```bash
gcloud iam service-accounts create quieter-gmail-push
PROJECT_NUMBER="$(gcloud projects describe "$GOOGLE_CLOUD_PROJECT" --format='value(projectNumber)')"
gcloud projects add-iam-policy-binding "$GOOGLE_CLOUD_PROJECT" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com" \
  --role="roles/iam.serviceAccountTokenCreator"
```

Set the four `GMAIL_PUBSUB_*` values from `.env.example` and deploy SST. Production provisions
`https://gmail-events.quieter.email` as an API Gateway custom domain and keeps its Vercel DNS record
pointed at the current gateway. Create the non-expiring authenticated push subscription against that
stable endpoint:

```bash
gcloud pubsub subscriptions create quieter-gmail-push \
  --topic=quieter-gmail \
  --push-endpoint="https://gmail-events.quieter.email" \
  --push-auth-service-account="$GMAIL_PUBSUB_PUSH_SERVICE_ACCOUNT" \
  --push-auth-token-audience="$GMAIL_PUBSUB_PUSH_AUDIENCE" \
  --ack-deadline=30 \
  --message-retention-duration=2678400s \
  --expiration-period=never \
  --min-retry-delay=10s \
  --max-retry-delay=600s
```

The principal creating or updating the subscription also needs
`roles/iam.serviceAccountUser` on the push-auth service account.
