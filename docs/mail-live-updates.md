# Live mail and browser caching

The browser uses one native WebSocket per active tab, routed to a `MailLiveUser` Durable Object keyed by authenticated user ID. The transport and events are provider-neutral. Gmail and managed mail publish the same hints; future provider adapters can reuse them. Realtime delivery is independent of subscription tier and AI automation.

## Delivery and recovery

`MailUpdatesWorker` is deployed independently of Gmail processing. Connections use signed, 90-second upgrade tickets. Established connections expire after five minutes and renew through the authenticated RPC. Native WebSocket auto-responses keep heartbeats compatible with Durable Object hibernation. A tab disconnects after 30 continuous seconds in the background and reconnects immediately on focus. Reconnects use bounded exponential backoff with jitter.

Events contain an ID, mailbox ID, change type, and optional thread IDs. They carry no message bodies or provider credentials. The server resolves current recipients for each broadcast: Gmail owners, managed mailbox owners and explicit grants, and eligible shared-mailbox division members. Being an organization member alone does not grant mailbox updates. Every subsequent data fetch also checks mailbox authorization.

The browser coalesces bursts for 150 ms and deduplicates recent event IDs. It refreshes active queries, using the existing bounded mailbox reconciliation path where available. Reconnect/focus and a single foreground 60-second recovery timer cover missed hints, provider notification gaps, and temporary transport failures. This is notification-driven refresh, not a durable browser event log or a full sync engine.

Gmail ingress acknowledges only after Queue acceptance. It emits a dirty hint before AI work; queue processing emits another hint after processing. Existing watch ownership and observation guards still apply. Managed ingestion publishes after committing the message and again after rules/automation. Mail mutations, label definitions, sent-message recording, and rule backfill batches also publish. Publishing is best effort with a three-second timeout; a broadcast failure is reported without changing the outcome of a committed operation. Recovery polling covers that gap.

The two-second goal applies to delivering an observed change to a connected browser. External-provider delivery delays, dropped notifications, and outages can exceed it. Production latency and cost still need measurement after deployment.

## Optimistic mutations

Reversible actions update visible query data immediately. A per-QueryClient coordinator serializes operations that affect the same mailbox/thread while allowing unrelated threads to proceed. It combines unsent operations with the same label-change scope. Confirmed data and pending intent are kept separately, including when mailbox deltas arrive during a write. An older response or failed write therefore cannot roll back the latest pending intent or discard newly arrived mail.

AbortSignals can stop reads and mutations before dispatch. They are not treated as proof that an accepted provider write was undone. Dispatched writes settle before the next conflicting operation runs. Reads still in flight are cancelled before confirming a write, so an older response cannot replace it. Logout disposes the coordinator, rejects unsent work, and ignores late results. This ordering is local to a tab; separate devices and collaborators reconcile against server/provider state. There is no persisted offline mutation queue or distributed last-click-wins guarantee. Destructive actions retain their existing pending guards.

## IndexedDB cache

`quieter-mail-cache-v1` stores mailbox-scoped query metadata and separate message-body records. It has a total estimated 100 MB budget, a 30-day retention limit, and LRU eviction toward 90 MB. Browser quota failures trigger extra eviction and one retry. Unavailable storage or a record that cannot fit falls back to normal network loading. Active thread records and bodies are protected from ordinary capacity eviction.

The cache holds at most five pages per unfiltered message-list query. Opened threads and the first five recent threads in an active unfiltered list are cached, with at most two prefetches in flight. Search results, raw MIME, headers, credentials, and attachment bytes are excluded. Missing body records cause a network fetch. Optimistic state is not persisted as confirmed state.

Records are scoped to the signed-in user and mailbox. Account changes fence in-flight cache operations and remove other users' records; logout clears the cache. Authorization/not-found failures purge the affected mailbox's disk cache. As with any local cache, access changes cannot erase an offline browser immediately. IndexedDB is a performance cache, never an authorization source.

## Local verification

Use the existing allowlisted development database and native Wrangler runtime:

```sh
vp run dev:setup
vp run dev:full
vp run env:doctor
vp run dev:fixtures <local-login-email>
vp run dev:fixtures <local-login-email> --fresh
```

`dev:prepare` builds both environment and observability packages before preparing ignored Worker bindings. `MAIL_UPDATES_URL` defaults to `ws://127.0.0.1:8787/mail/live`. The development CSP permits only the configured loopback WebSocket origin; production continues to require secure transport. Restart both runtimes after changing bindings.

Open the fixture mailbox, then run `--fresh` to ingest another synthetic message through the managed-mail ingestion path. It uses local R2, never sends external email, and should appear without refreshing. Inspect `quieter-mail-cache-v1` in browser developer tools, open recent messages, reverse labels/read state, and switch tabs for more than 30 seconds. Native tests cover hibernation, user isolation, expired tickets and sessions; browser-state tests cover background timing, reconnection, event coalescing, persistence, eviction, and mutation races.

Keep shared Gmail in `observe` mode with production watch ownership. Real Gmail mutation and webhook-delivery tests require a dedicated mailbox or an explicit ownership handoff. Local tests do not validate SES/MX delivery, cloud concurrency, or production cost.

## Rollout

Deploy through the protected SST workflow. This adds a new Durable Object namespace and Worker; it does not change the database schema. The old Gmail endpoint and Durable Object remain during rolling releases so already-open older clients continue working. Deploy the new Worker and producer bindings before removing any legacy transport. A later cleanup can remove the old endpoint after older browser sessions have aged out.
