# Live mail and browser caching

The browser uses one native WebSocket per active tab, routed to a `MailLiveUser` Durable Object keyed by authenticated user ID. The transport and events are provider-neutral. Gmail and managed mail publish the same hints; future provider adapters can reuse them. Realtime delivery is independent of subscription tier and AI automation.

## Delivery and recovery

`MailUpdatesWorker` is deployed independently of Gmail processing. Connections use signed, 90-second upgrade tickets. Established connections expire after five minutes and renew through the authenticated RPC. Native WebSocket auto-responses keep heartbeats compatible with Durable Object hibernation. A tab disconnects after 30 continuous seconds in the background and reconnects immediately on focus. Reconnects use bounded exponential backoff with jitter.

Events contain an ID, mailbox ID, change type, and optional thread IDs. Typed events also carry a mailbox change version and the kinds of changes that committed. They carry no message bodies, verification codes, or provider credentials. The server resolves current recipients for each broadcast. Recipients include Gmail owners, managed mailbox owners, users with explicit grants, and eligible shared-mailbox division members. Being an organization member alone does not grant mailbox updates. Replay checks mailbox authorization and filters entries with explicit recipients.

The browser coalesces bursts for 150 ms and deduplicates recent event IDs. Gmail and managed mailbox windows carry their own applied journal version. The authenticated `syncMailbox` RPC replays changes for a window. `pullMailboxChanges` groups up to seven windows for one mailbox into a single request, including recently used views whose cache is still present. Both routes use the same folder projection as the corresponding list read. A gap refreshes the affected window while its cached rows stay visible. Socket hints and command receipts never advance the applied version.

A failed window in a grouped request keeps its current checkpoint and can retry independently. Successful windows in the same response still apply their changes.

Verification-code refreshes run independently of message refreshes, so a slow inbox request cannot delay a newly extracted code. Reconnects, focus, and a foreground 60-second recovery timer also reconcile Gmail history. When a replay gap, expired provider history, or an unsupported search requires reconciliation, the browser reloads a bounded set of list pages. The journal retains 256 versions per mailbox. Replay reads up to 64 versions and reconciles if the changes exceed its limits.

Message views reuse codes already fetched for the same mailbox and message while their own lookup runs. Inline codes in inbox rows and message views remain available after expiry. Only the idle panel filters its current-code suggestions by expiry.

Gmail history checkpoints, capture changes, importance, and verification-code availability commit with their journal entries. When the durable relay is enabled, the same transaction enqueues the live update. With the relay off, the producer publishes after commit using the legacy transport. Each legacy delivery attempt has a three-second timeout. A broadcast failure leaves the committed journal available for recovery. Existing watch ownership and observation guards still apply. Managed ingestion, outbound, draft, label, placement, and snooze changes also journal their projection changes in the write transaction. Scheduled-send hints are scoped to the user who owns the scheduled entry.

Gmail replay can reuse an encrypted thread metadata generation across requests for the same authorized mailbox and change coverage. A database lease coalesces concurrent fills. The cache keeps one generation per mailbox, caps it at 512 KiB, and expires it for reuse after 30 seconds. Each view still computes its own message anchor and enrichment. Recovery reads use fresh provider history.

The two-second goal applies to delivering an observed change to a connected browser. External-provider delivery delays, dropped notifications, and outages can exceed it. Production latency and cost still need measurement after deployment.

The transport uses the SST-managed custom hostname `updates.quieter.email` in production and `<stage>-updates.quieter.email` for deployed development stages. The configured URL is known before the Worker exists, so the prepared web build sees the same bindings during preview and deployment. Local development continues to use the loopback Worker URL. Do not derive build configuration from the new Worker's generated URL or bypass prepared-build verification to bootstrap it.

## Optimistic mutations

Reversible actions update visible query data immediately. A per-QueryClient coordinator serializes operations that affect the same mailbox/thread while allowing unrelated threads to proceed. It combines unsent operations with the same label-change scope. Confirmed data and pending intent are kept separately, including when mailbox deltas arrive during a write. An older response or failed write therefore cannot roll back the latest pending intent or discard newly arrived mail.

The UI settles after its optimistic change. In-flight reads for affected records are fenced when a command confirms, and other reads continue. A stable request ID allows a lost response to be retried with the same payload and lets the server replay a stored outcome. A definitive failure rolls back the affected optimistic change. Partial Gmail writes keep their confirmed subset. An uncertain write triggers authoritative reconciliation without automatically dispatching a new write. Catch-up runs in the background after the command burst drains.

Command receipts record when a write can reach the provider. An expired claim that stopped before dispatch can be reclaimed with the same ID. An ambiguous dispatch requires reconciliation. When the server knows which steps applied, it can resume a recorded follow-up with the original ID, such as adding the Inbox label after untrashing. The client uses the replayed result to settle the command and refreshes affected records for current metadata.

Command receipts are retained for 30 days. Mail maintenance removes expired receipts in bounded batches and leaves recent in-flight claims alone.

Logout or confirmed mailbox access loss disposes the affected coordinator state, rejects unsent work, and ignores late results. Separate devices and collaborators converge through replay. There is no persisted offline write queue or distributed last-click-wins guarantee. Destructive actions retain their existing pending guards.

## IndexedDB cache

`quieter-mail-cache-v1` stores mailbox-scoped query metadata and separate message-body records. It has a total estimated 100 MB budget, a 30-day retention limit, and LRU eviction toward 90 MB. Browser quota failures trigger extra eviction and one retry. Unavailable storage or a record that cannot fit falls back to normal network loading. Active thread records and bodies are protected from ordinary capacity eviction.

The cache holds at most five pages per unfiltered message-list query. The active list queues up to 60 full threads from the viewport and the two screens below it. The queue prioritizes visible rows, then unread and important threads within each screen. It uses at most two background requests at once, with a separate slot for hover or keyboard intent. Speculative reads skip the server's open-triggered capture and importance processing. Search result lists, raw MIME, headers, credentials, and attachment bytes are excluded from disk storage. Missing body records cause a network fetch. Optimistic state is not persisted as confirmed state.

The protected route's authenticated session initializes the workspace QueryClient. The restore reads the mailbox catalog, unread counts, and account preferences together, then loads bounded windows and label catalogs for mailboxes in the current access list. Unfiltered Drafts and Later lists use the same cache and revalidate on open. The catalog revalidates in the background on mount and reconnect. Access hints and authoritative read failures remove revoked mailbox data from memory and disk while other mailboxes stay available. Unseen mail and unsupported search filters still require an authoritative read.

An access failure also blocks warm restoration for that mailbox until the server confirms renewed access. Settings revalidates a warm session in the background. A confirmed expiry retires that session, and responses from superseded session loads cannot repopulate its cache.

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

Apply the additive journal, command receipt (including execution state), and Gmail metadata migrations through the protected workflow before releasing the readers that use them. Deploy journal-producing Workers before switching web clients to managed replay wherever possible. During mixed versions, a legacy managed content revision without the corresponding journal entry triggers a window refresh. Existing clients keep the single-window endpoint and the compatible `mailbox.changed` envelope. Keep legacy transport available during rolling releases.

Measure warm launch, view switching, thread opening, and label-picker readiness separately from first use on a fresh device. Check connected-device propagation and replay recovery independently of time spent waiting for external Gmail notifications. Exercise older desktop clients against the new server before cutting over the web client.
