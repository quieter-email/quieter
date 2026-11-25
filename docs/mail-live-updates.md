# Live mail and browser caching

The browser uses one native WebSocket per active tab, routed to a `MailLiveUser` Durable Object keyed by authenticated user ID. The transport and events are provider-neutral. Gmail and managed mail publish the same hints; future provider adapters can reuse them. Realtime delivery is independent of subscription tier and AI automation.

## Delivery and recovery

`MailUpdatesWorker` is deployed independently of Gmail processing. Connections use signed, 90-second upgrade tickets. Established connections expire after five minutes and renew through the authenticated RPC. Native WebSocket auto-responses keep heartbeats compatible with Durable Object hibernation. A tab disconnects after 30 continuous seconds in the background and reconnects immediately on focus. Reconnects use bounded exponential backoff with jitter.

Events contain an ID, mailbox ID, change type, and optional thread IDs. Typed events also carry a mailbox change version and the kinds of changes that committed. They carry no message bodies, verification codes, or provider credentials. The server resolves current recipients for each broadcast. Recipients include Gmail owners, managed mailbox owners, users with explicit grants, and eligible shared-mailbox division members. Being an organization member alone does not grant mailbox updates. Replay checks mailbox authorization and filters entries with explicit recipients.

The browser coalesces bursts for 150 ms and deduplicates recent event IDs. Gmail inbox reads include the latest journal version. The authenticated `syncMailbox` RPC replays later entries and rebuilds affected rows with the same thread summaries as the inbox list. The browser applies those rows through its existing mailbox delta and optimistic mutation coordinator. Each cached list tracks the version it applied. Reordered signals can then be ignored after their changes have been applied.

Verification-code refreshes run independently of message refreshes, so a slow inbox request cannot delay a newly extracted code. Reconnects, focus, and a foreground 60-second recovery timer also reconcile Gmail history. When a replay gap, expired provider history, or an unsupported search requires reconciliation, the browser reloads a bounded set of list pages. The journal retains 256 versions per mailbox. Replay reads up to 64 versions and reconciles if the changes exceed its limits.

Message views reuse codes already fetched for the same mailbox and message while their own lookup runs. Inline codes in inbox rows and message views remain available after expiry. Only the idle panel filters its current-code suggestions by expiry.

Gmail history checkpoints, capture changes, importance, and verification-code availability commit with their journal entries. When the durable relay is enabled, the same transaction enqueues the live update. With the relay off, the producer publishes after commit using the legacy transport. Each legacy delivery attempt has a three-second timeout. A broadcast failure leaves the committed journal available for recovery. Existing watch ownership and observation guards still apply. Managed ingestion publishes after committing the message and again after rules run. Mail mutations, label definitions, sent-message recording, and rule backfill batches also publish.

The two-second goal applies to delivering an observed change to a connected browser. External-provider delivery delays, dropped notifications, and outages can exceed it. Production latency and cost still need measurement after deployment.

The transport uses the SST-managed custom hostname `updates.quieter.email` in production and `<stage>-updates.quieter.email` for deployed development stages. The configured URL is known before the Worker exists, so the prepared web build sees the same bindings during preview and deployment. Local development continues to use the loopback Worker URL. Do not derive build configuration from the new Worker's generated URL or bypass prepared-build verification to bootstrap it.

## Optimistic mutations

Reversible actions update visible query data immediately. A per-QueryClient coordinator serializes operations that affect the same mailbox/thread while allowing unrelated threads to proceed. It combines unsent operations with the same label-change scope. Confirmed data and pending intent are kept separately, including when mailbox deltas arrive during a write. An older response or failed write therefore cannot roll back the latest pending intent or discard newly arrived mail.

AbortSignals can stop reads and mutations before dispatch. They are not treated as proof that an accepted provider write was undone. Dispatched writes settle before the next conflicting operation runs. Reads still in flight are cancelled before confirming a write, so an older response cannot replace it. Logout disposes the coordinator, rejects unsent work, and ignores late results. This ordering is local to a tab; separate devices and collaborators reconcile against server/provider state. There is no persisted offline mutation queue or distributed last-click-wins guarantee. Destructive actions retain their existing pending guards.

## IndexedDB cache

`quieter-mail-cache-v1` stores mailbox-scoped query metadata and separate message-body records. It has a total estimated 100 MB budget, a 30-day retention limit, and LRU eviction toward 90 MB. Browser quota failures trigger extra eviction and one retry. Unavailable storage or a record that cannot fit falls back to normal network loading. Active thread records and bodies are protected from ordinary capacity eviction.

The cache holds at most five pages per unfiltered message-list query. The active list queues up to 60 full threads from the viewport and the two screens below it. The queue prioritizes visible rows, then unread and important threads within each screen. It uses at most two background requests at once, with a separate slot for hover or keyboard intent. Speculative reads skip the server's open-triggered capture and importance processing. Search result lists, raw MIME, headers, credentials, and attachment bytes are excluded from disk storage. Missing body records cause a network fetch. Optimistic state is not persisted as confirmed state.

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

Deploy the additive journal migration before the application and Gmail workers through the protected workflow. The optional typed fields extend the existing update envelope, so older clients continue to refresh on `mailbox.changed`. The old Gmail endpoint and Durable Object remain during rolling releases. Deploy the new Worker and producer bindings before removing legacy transport.
