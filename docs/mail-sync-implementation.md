# Mail sync implementation

The custom engine is the only Gmail and managed-mail synchronization implementation on the feature branch. Production deployment and provider-write canaries remain separate protected operations. This document records the delivered behavior and operating instructions for [the design](custom-mail-sync-engine-plan.md).

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

The browser engine runs in a Worker and shares leadership and updates across tabs. It fences snapshots, late HTTP responses, resets, account switches, and revoked access by mailbox and generation. The app uses explicit query and compose adapters. The old Gmail dirty-event sockets, history-delta polling, localStorage query persistence, rollout flags, and direct metadata mutation endpoints have been removed. Startup waits for the worker and authorized mailbox inventory; reading one mailbox does not wait for every replica to bootstrap. Missing runtime configuration is an error. Authenticated HTTP snapshots, replay, list and body reads are part of this engine. Manual refresh triggers provider reconciliation and checkpoint catch-up.

Gmail watches and live ingestion are available on every plan. Only AI automation remains gated by the paid entitlement. A team can connect 5 Gmail accounts on Free, 25 on Managed, or 100 on Pro, shared across its members. Managed mailboxes do not consume these Gmail slots. OAuth completion and mailbox moves lock the destination team row and recheck capacity inside the write transaction, preventing concurrent connections from exceeding the limit. Reconnecting an existing account is allowed above the limit after a downgrade; additional connections are blocked without deleting mail. A browser session supports up to 256 mailbox subscriptions, including managed mailboxes and multiple teams.

Read/unread, labels, archive, spam, trash, and restore use optimistic overlays before network submission. Repeated actions update the UI immediately while their submissions stay ordered per mailbox. Failed commands remove their own overlay and preserve later optimistic changes. Provider work and confirmed updates arrive asynchronously. Trash and restore use move commands so the provider adapter can call the appropriate Gmail operations.

Idle WebSocket pings receive a native Cloudflare auto-response without invoking the User Durable Object handler, querying PostgreSQL, or renewing mailbox subscriptions. A separate two-minute Durable Object alarm rechecks access and renews five-minute mailbox subscriptions. Session checks are shared within each maintenance pass. Explicit access-change notifications still revalidate immediately, and delivery checks access again when its last check is older than 30 seconds. If a delayed renewal finds an expired mailbox subscription, it sends a head checkpoint so the client can recover missed changes. The alarm also enforces connection lifetime and stops when connections close.

When all Quieter tabs are hidden, browser synchronization pauses after a 30-second grace period. The connection and fallback polling stop, the tab releases its leadership lease, and existing cache and pending commands remain intact. A visible peer keeps the shared connection active. Returning to a tab immediately catches up from its saved checkpoint and resumes connection ownership. Visibility means the Page Visibility API, not merely losing keyboard focus. Browser suspension can delay the grace timer; the server still bounds idle connection lifetime. Background-only tabs do not receive live mail notifications while paused, and server-side ingestion continues independently.

## Storage and retention

PostgreSQL keeps provider-neutral metadata, body references, mailbox checkpoints, command receipts, provider submission records, the replay log, and the delivery outbox. Bodies are immutable SHA-256-addressed HTML/text objects in private R2. Managed-mail body/search columns remain available to the existing AI and search services.

The replay retention window is 14 days. Clients behind the retained floor take a fresh snapshot. Terminal command receipts are retained for 90 days. Body collection requires an object to be at least 30 days old, have no current references, and be older than the retained replay floor. Mailbox transaction locks coordinate projection commits with collection; commits check that newly referenced bodies still exist. Reference tracking initializes lazily under that lock, including retained log references. This also protects upload/commit races and mailbox recreation.

Scheduled collection scans 100 R2 objects per minute using a persisted cursor. This is deliberately modest for the first deployment. Monitor the scan cycle before increasing it for a large archive. The minute maintenance sweep schedules quiet Gmail mailbox recovery every 15 minutes; incoming push notifications and incomplete imports do not wait for this interval.

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

`MAIL_SYNC_SECRET` is the SST `MailSyncSecret` resource. Local setup generates ignored bindings without copying migration credentials into Worker runtimes. `MAIL_SYNC_URL` is required ordinary configuration. Restart the full runner after binding changes; Vite hot reload does not restart separate Wrangler processes.

At handoff, the local runtimes have working isolated bindings. Uploading the new secret to the existing personal SST development stage was blocked by expired AWS SSO. After completing the AWS login, run `vp run secrets:dev push local-leander`. This step does not deploy the application. No production secret was copied locally.

## Verification

Focused suites cover native ping auto-responses after hibernation, idle authorization, renewal, socket expiry, 100-mailbox subscriptions, hidden-tab pause, multi-tab resume, startup waiting, and optimistic action ordering. Disposable PostgreSQL suites cover sync transactions and race-safe team limits for all plans, reconnects, moves, ownership and rollback. These integration suites refuse shared development or production targets and create only their own test schemas. See the pull request for the latest run counts.

The latest workspace run passed 828 tests with 69 infrastructure-dependent tests skipped. Separate runs passed all 69 database integration tests against a freshly migrated disposable PostgreSQL database, plus 47 native Worker tests. Formatting, lint, type checks, the web production build, deployment bundle checks, import boundaries, Cloudflare generated types and environment doctor passed. This cleanup adds no migrations. Database fixtures supply in-memory sync body storage and current draft versions while exercising real projection transactions and conflict checks.

React Doctor previously scored 81. Its latest release completed the lint scan but failed its maintainability analysis and did not return a comparable score. It still reports three React Compiler limitations around `try/finally` and advisory performance findings. The production build succeeds; this diagnostic run is not reported as a clean React Doctor pass.

Real browser checks covered incoming messages in two tabs, a follower showing the live state, bodies persisted before opening, and no content fetch on the subsequent click. Draft checks covered background autosave, reload recovery with incomplete fields, stale-save conflicts, and preserving a saved attachment through repeated saves and rehydration. HTML preparation did not load remote images or tracker resources during the check.

After the single-engine cleanup, a fresh authenticated browser session reached live status with two mailboxes, loaded a cached managed message, received a newly injected message without refreshing, and archived a fixture into the Archive view. No old mail-query localStorage keys remained. The first simultaneous local startup hit a native SQLite recovery lock; stopping the failed runtimes and rerunning `dev:full` succeeded without deleting local state.

An optional reproducible browser fixture remains available through `vp run test:sync-browser`. Further large-archive and hard performance benchmarking was deferred at the user's request. Local checks do not establish a production cache-hit SLA or guarantee that every previously unseen archived message is already cached.

## Deployment and rollback

Five additive generated migrations introduce the sync schema and body-reference registry. They were reviewed and applied only to `quieter_dev`. Production migrations and deployment were not run. Use the protected deployment workflow and its database checks; create the production `MailSyncSecret` through SST before the first deployment. Team Gmail limits need no additional schema migration.

Deploy the additive schema before the new writers, then the dedicated sync runtime and application. There is no alternate client engine or cohort switch. Verify dedicated test mailboxes, provider writes, duplicate notifications, reconnects, delivery feedback and alerts through the protected workflow.

The Gmail ingress keeps its existing resource name and URL. Its immutable Durable Object migration `v1` remains in infrastructure history; migration `v2` retires the old `GmailLiveSyncMailbox` namespace. That namespace held socket state, not email data. The queue consumer is updated first to remove its cross-worker binding. This retires existing legacy sockets at deployment; already-open clients from the old release must reload. No old class or WebSocket route remains in executable code.

Keep one Gmail watch/write owner across environments. Local shared accounts remain in observation mode; dedicated Gmail write canaries or an explicit ownership handoff are required to verify real external saves, sends, and mutations. Managed fixtures do not prove production SES/IAM/MX delivery.

Rollback requires a build compatible with this engine's schema and protocol. Before changing server writers, drain pending commands and inspect unknown provider submissions. Preserve the new schema, queues, Durable Object namespaces, and R2 bucket. Resolve unknown sends from provider evidence before authorizing a new send. Restoring the removed engine is not a supported runtime switch.

Gmail does not offer an atomic conditional draft update against simultaneous edits in another Gmail client. Version checks and preserved recovery copies reduce the risk, but cannot eliminate that external race. Verify this behavior on the dedicated write canary before wider rollout.

## Operations

The Worker emits `mail_sync_metric` records for queue duration, age and attempts, maintenance and collection counts, pending outbox and command ages, and unknown submissions. These records contain numeric aggregates and fixed operation names. Unexpected failures go to the existing reporting boundary with request content and private context removed; local Sentry and PostHog remain disabled by default.

The private `GET /internal/health` endpoint requires the linked sync bearer secret and returns aggregate counts and ages with `no-store`. Inspect the Worker logs and dead-letter queue when backlog grows. Initial alert thresholds to configure during the protected rollout are an outbox age above 30 seconds, a command age above two minutes, or unknown submissions remaining for five minutes. Repeated queue failures or client resets also warrant investigation. These thresholds are starting values, not installed production alerts.

Client diagnostics expose bounded numeric samples through `getMailSyncMeasurements`. Consented analytics flush aggregate counts, totals, and maxima once per minute, without mailbox IDs, message data, or private URL parameters. Navigation sampling measures component commit to a ready frame, not the full click-to-paint interval. Use it to find regressions before considering heavier measurements.
