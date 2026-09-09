# Mail sync implementation

The first release is implemented on the feature branch and verified locally. Production deployment and provider-write canaries remain separate protected operations. This document records the delivered behavior and operating instructions for [the design](custom-mail-sync-engine-plan.md).

The engine lives in separate packages. Existing application code connects through explicit adapters, transaction hooks, and UI adapters. Avoid distributing protocol, persistence, and transport decisions throughout existing services.

| Package | Responsibility |
| --- | --- |
| `@quieter/sync` | Provider-neutral wire contracts and pure reconciliation rules |
| `@quieter/sync-server` | Transactional projection, log, outbox, snapshots, replay, commands, body storage contracts, provider adapters |
| `@quieter/sync-client` | Browser replica, persistence, scheduler, transport, cache policy |
| `@quieter/sync-worker` | Dedicated Cloudflare runtime, Durable Objects, delivery and recovery |
| `@quieter/orpc` | Thin authorization and existing domain-operation bridge |

The server package receives a database client and delivery/body-storage dependencies. It does not import the application API or UI. Provider adapters are separate entry points so the delivery runtime does not load their dependency graphs unnecessarily.

Saving a provider change and appending its sync batch remain in one database transaction. After commit, the bridge sends that exact batch directly to the delivery runtime. The normal delivery path does not read PostgreSQL again.

## Delivered behavior

Gmail import, history notifications, expired-history repair, and managed-mail transaction hooks produce the same mailbox projections. Messages, threads, labels, saved views, counts, delivery feedback, commands, and access changes use the shared protocol. Gmail REST calls and credential handling stay in server packages.

Mailbox Durable Objects coalesce work and route committed batches to user Durable Objects. User sockets use hibernation, expiring signed tickets, session checks, mailbox authorization, bounded frames, acknowledgements, and replay. PostgreSQL stores the ordered log and outbox. A crash after commit is recovered from the outbox; a missed or out-of-order delivery causes replay. Snapshots and bodies use authenticated HTTPS. Polling starts only after repeated socket failures.

Commands carry stable IDs, serialize provider work per mailbox, retain receipts, and retry recoverable failures. Optimistic UI state is reconciled against those receipts. Draft versions detect stale saves. A separate provider submission journal records an unknown outcome before Gmail sends or saves, then reconciles it using the stable Message-ID. An uncertain send is never blindly repeated.

The browser engine runs in a Worker and shares leadership and updates across tabs. It fences snapshots, late HTTP responses, resets, account switches, and revoked access by mailbox and generation. The app uses explicit query and compose adapters. Healthy engine clients stop the old dirty-event connection, periodic inbox refresh, and mail-query localStorage persistence. Compatibility paths remain available for rollout.

## Storage and retention

PostgreSQL keeps provider-neutral metadata, body references, mailbox checkpoints, command receipts, provider submission records, the replay log, and the delivery outbox. Bodies are immutable SHA-256-addressed HTML/text objects in private R2. Managed-mail body/search columns remain available to the existing AI and search services.

The replay retention window is 14 days. Clients behind the retained floor take a fresh snapshot. Terminal command receipts are retained for 90 days. Body collection requires an object to be at least 30 days old, have no current references, and be older than the retained replay floor. Mailbox transaction locks coordinate projection commits with collection; commits check that newly referenced bodies still exist. Reference tracking initializes lazily under that lock, including retained log references. This also protects upload/commit races and mailbox recreation.

Scheduled collection scans 100 R2 objects per minute using a persisted cursor. This is deliberately modest for the first deployment. Monitor the scan cycle before increasing it for a large archive. Queues and R2 buckets remain provisioned when traffic flags are disabled.

The browser persists metadata, coverage, checkpoints, command recovery, and compressed bodies in user-scoped IndexedDB databases. Defaults are 200 MiB on desktop browsers and 75 MiB on mobile. Available storage can reduce the automatic budget to 10 MiB; the manual control accepts 25 to 250 MiB. The budget covers replica data rather than all browser disk overhead. Visible and selected threads receive prefetch priority and pin protection; older bodies and metadata are evicted. Storage failures degrade to memory and network operation with visible recovery errors where needed.

Body memory is bounded separately at 32 MiB. Prepared, sanitized HTML uses a 16 MiB memory cache and is warmed during idle time. Attachments and remote images are not automatically persisted by the sync engine. Editing a saved draft can retrieve its existing attachments into memory through authorized application requests, preserving attachment references through later saves.

Draft recovery uses a separate IndexedDB journal, keyed by mailbox, draft, and editor. Each serialized draft is limited to 8,388,608 characters. The journal preserves incomplete recipients, subject, and content across reloads; it is separate from the evictable mail cache. Clearing the mail cache keeps these recovery copies. Logout and revoked mailbox access purge them. Attachment bytes stay in memory, so an unsaved attachment must be attached again after a reload. Saved attachment references can be retrieved again. Cached reading during disconnection is incidental; full offline operation is not a product promise.

## Local operation

Normal development uses the allowlisted `quieter_dev` database and native Wrangler simulations for Durable Objects, Queues, and R2. It does not create a paid database branch or require a persistent local PostgreSQL installation.

```bash
vp run dev:setup
vp run db:migrate
vp run dev:full
```

`db:migrate` runs only after the existing local destination guards accept the configured development database. The web app uses port 3000, the existing background runtime uses 8787, and the dedicated sync runtime uses 8788. The full runner requires its ports to be free. Vite triggers native Wrangler scheduled maintenance after startup and once per minute; Durable Object alarms and queue consumers run in Wrangler. All local runtimes share the ignored `.wrangler/state` directory.

After signing into the local app, create the private managed mailbox fixture and inject another incoming message:

```bash
vp run dev:fixtures your-local-login@example.com
vp run dev:fixtures your-local-login@example.com incoming
vp run dev:trigger sync-maintenance
vp run env:doctor
```

The fixture creates local MIME content and attachment metadata without sending external mail. Open two tabs on its mailbox to verify delivery, background body loading, and follower updates. The maintenance trigger also exercises recovery without waiting for the schedule. See [development](development.md) and [service inspection](development-services.md) for provider setup and existing background diagnostics.

`MAIL_SYNC_SECRET` is the SST `MailSyncSecret` resource. Local setup generates ignored bindings without copying migration credentials into Worker runtimes. Sync URLs and rollout flags are ordinary configuration. Restart the full runner after binding changes; Vite hot reload does not restart separate Wrangler processes.

At handoff, the local runtimes have working isolated bindings. Uploading the new secret to the existing personal SST development stage was blocked by expired AWS SSO. After completing the AWS login, run `vp run secrets:dev push local-leander`. This step does not deploy the application. No production secret was copied locally.

## Verification

The workspace suite passed 831 tests, with 62 tests skipped because their external or disposable infrastructure prerequisites were absent. Separate runs passed 15 sync-server tests with real disposable loopback PostgreSQL and eight native Worker transport/R2 tests. The database integration suite refuses shared development or production targets and creates only its own test schemas.

The web production build, deployment bundle checks, import boundaries, Cloudflare generated types, environment doctor, and migration consistency checks passed. React Doctor improved from 74 to 81 on changed files; its remaining compiler-syntax and advisory complexity/performance findings are not runtime test failures.

Real browser checks covered incoming messages in two tabs, a follower showing the live state, bodies persisted before opening, and no content fetch on the subsequent click. Draft checks covered background autosave, reload recovery with incomplete fields, stale-save conflicts, and preserving a saved attachment through repeated saves and rehydration. HTML preparation did not load remote images or tracker resources during the check.

An optional reproducible browser fixture remains available through `vp run test:sync-browser`. Further large-archive and hard performance benchmarking was deferred at the user's request. Local checks do not establish a production cache-hit SLA or guarantee that every previously unseen archived message is already cached.

## Deployment and rollback

Five additive generated migrations introduce the sync schema and body-reference registry. They were reviewed and applied only to `quieter_dev`. Production migrations and deployment were not run. Use the protected deployment workflow and its database checks; create the production `MailSyncSecret` through SST before the first deployment, even if traffic is initially disabled.

The staged rollout is:

1. Deploy the additive schema and runtime with `QUIETER_MAIL_SYNC_ENABLED=true` and `QUIETER_MAIL_SYNC_CLIENT_ENABLED=false`. This runs server projection and recovery while keeping clients on the existing path.
2. Enable clients with `QUIETER_MAIL_SYNC_CLIENT_ENABLED=true` and a comma-separated exact user-ID cohort in `QUIETER_MAIL_SYNC_CLIENT_USERS`.
3. Verify dedicated test mailboxes, provider writes, duplicate notifications, reconnection, delivery feedback, and alert behavior. Then widen the client cohort. An empty cohort value permits all users when the client flag is enabled.
4. Retire the compatibility paths only after production parity and recovery checks pass.

The cohort controls client activation. It does not limit server projection work to those users. Keep one Gmail watch/write owner across environments. Local shared accounts remain in observation mode; dedicated Gmail write canaries or an explicit ownership handoff are required to verify real external saves, sends, and mutations. Managed fixtures do not prove production SES/IAM/MX delivery.

For a UI rollback, set `QUIETER_MAIL_SYNC_CLIENT_ENABLED=false` while leaving the server flag enabled. Active sockets reconnect at their heartbeat, and connection discovery selects the existing UI path without reporting a false logout or clearing draft recovery. This preserves server commands, receipts, outbox delivery, and provider reconciliation.

Before disabling the whole server engine or restoring older writers, drain pending commands and inspect unknown provider submissions. Keep the additive schema, queues, Durable Object namespaces, and R2 bucket. Do not delete them as a recovery step. Resolve unknown sends from provider evidence before authorizing a new send.

Gmail does not offer an atomic conditional draft update against simultaneous edits in another Gmail client. Version checks and preserved recovery copies reduce the risk, but cannot eliminate that external race. Verify this behavior on the dedicated write canary before wider rollout.

## Operations

The Worker emits `mail_sync_metric` records for queue duration, age and attempts, maintenance and collection counts, pending outbox and command ages, and unknown submissions. These records contain numeric aggregates and fixed operation names. Unexpected failures go to the existing reporting boundary with request content and private context removed; local Sentry and PostHog remain disabled by default.

The private `GET /internal/health` endpoint requires the linked sync bearer secret and returns aggregate counts and ages with `no-store`. Inspect the Worker logs and dead-letter queue when backlog grows. Initial alert thresholds to configure during the protected rollout are an outbox age above 30 seconds, a command age above two minutes, or unknown submissions remaining for five minutes. Repeated queue failures or client resets also warrant investigation. These thresholds are starting values, not installed production alerts.

Client diagnostics expose bounded numeric samples through `getMailSyncMeasurements`. Consented analytics flush aggregate counts, totals, and maxima once per minute, without mailbox IDs, message data, or private URL parameters. Navigation sampling measures component commit to a ready frame, not the full click-to-paint interval. Use it to find regressions before considering heavier measurements.
