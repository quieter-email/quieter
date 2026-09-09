# Custom mail sync engine plan

Status: implemented on the feature branch, with local verification complete. Recorded on September 9, 2026. See [implementation and rollout](mail-sync-implementation.md) for the delivered behavior, operating instructions, and production prerequisites.

Build a custom mail sync engine using Cloudflare Workers, Durable Objects, Queues, PostgreSQL, R2, and an IndexedDB client replica.

Gmail and managed mail use the same delivery protocol, client storage, optimistic actions, and UI integration. Provider adapters handle their different APIs and delivery mechanisms.

The scope includes incoming mail, message changes, labels, threads, senders, drafts, outgoing mail, delivery status, and mailbox access. The browser maintains a bounded cache with proactively downloaded bodies. Cached reading works during connection loss, without making full offline operation a product feature.

This plan records the custom-engine decision. Zero and other hosted replication engines are outside the chosen architecture.

1. Set measurable targets for "instant."

   These are initial engineering targets, to validate during implementation:

   | Experience | Target |
   | --- | --- |
   | Open a prepared message | Local data lookup below 1 ms; ordinary message rendered within 50 ms at p99 |
   | Open mail during normal use | At least 99% without starting a body download on click |
   | Receive a committed server change | Visible in a connected client within 500 ms at p95 |
   | Process ordinary incoming mail | Aim for 1-2 seconds from our receipt of the provider event to a usable message |
   | Reconnect | Resume from the saved checkpoint, without reloading the mailbox |
   | Archive, mark read, change labels | Immediate optimistic feedback |
   | Desktop browser storage | Approximately 200 MB by default, adaptive |
   | Mobile browser storage | Approximately 75-100 MB by default |
   | Attachments | Metadata synchronized; no automatic attachment downloads |

   The timing boundaries matter. We control delivery after an event reaches Quieter. Google can delay a notification before we receive it.

   A message that has never been downloaded, opened through a direct link, necessarily needs a fetch. Measure those cases separately and publish the overall hit rate, so we cannot make the numbers look good by excluding inconvenient clicks.

2. Build on the existing provider and mail infrastructure, while replacing the current invalidation model.

   The repository already contains useful pieces:

   | Current implementation | What changes |
   | --- | --- |
   | Gmail Durable Object broadcasts dirty notifications | Replace these with versioned changes and resumable delivery |
   | Managed ingestion commits messages and increments a mailbox revision | Add the shared change log and immediate delivery |
   | Gmail queries often fetch directly from Google | Introduce a durable server projection that the UI can replicate |
   | The browser persists selected list data in localStorage | Replace mail persistence with normalized IndexedDB storage, including bodies |
   | Thread bodies live mainly in the in-memory query cache | Download and persist bodies before navigation |
   | Optimistic actions use several query-cache update paths | Centralize reconciliation and command tracking |

   The relevant starting points are the existing [mail contracts](../packages/mail/src/data-plane.ts), [mail queries](../packages/orpc/src/mail/queries.ts), [Gmail live connection](../packages/cloudflare/src/gmail-live-sync-mailbox.ts), and [query persister](../apps/web/src/lib/query-persister.ts).

   This describes the codebase inspected for the plan. It does not claim that the current production services' health was verified.

3. Give each infrastructure component one clear responsibility.

   ```mermaid
   flowchart TD
       G[Gmail notifications] --> A[Provider adapters and durable jobs]
       M[Managed mail receipts] --> A
       F[Future Outlook and IMAP adapters] --> A

       A --> C[Shared mail commit service]
       C --> P[(PostgreSQL: mail state, change log, outbox)]
       C --> R[(R2: message bodies)]

       C -->|Committed change batch after commit succeeds| MD[MailboxSync Durable Object]
       P --> D[Outbox recovery and replay]
       D -->|Retry or missing batches| MD
       MD --> UD[UserSync Durable Object]
       UD <-->|WebSocket| W[Browser sync worker]

       W --> I[(IndexedDB)]
       W --> Q[Memory cache and UI]
       W -->|Commands| C
       R -->|Authorized body downloads| W
   ```

   | Component | Responsibility |
   | --- | --- |
   | PostgreSQL | Canonical Quieter data, ordered changes, provider checkpoints, commands, durable pending work |
   | `MailboxSync` Durable Object | Coordinate delivery for one mailbox, coalesce wakeups, distribute changes to subscribed users |
   | `UserSync` Durable Object | Multiplex a user's authorized mailboxes onto their client connections |
   | Cloudflare Queues | Provider processing, retries, backfills, and repair jobs |
   | R2 | Immutable, versioned message bodies and temporary snapshot objects |
   | Browser sync worker | Connection, reconciliation, persistence, downloads, and cache scheduling |
   | TanStack Query | React-facing server-state views over the local replica |
   | TanStack Store | Client workflows such as selection, prefetch scheduling, and connection status |

   Durable Object IDs use immutable user/mailbox IDs within the deployment stage. Retire the current email-address-based Gmail identity.

   Durable Objects retain small coordination records and bounded delivery caches. The mailbox archive remains in PostgreSQL and R2. Hibernation preserves WebSockets but discards in-memory object state, so subscriptions and pending delivery must be recoverable from storage. [Cloudflare's WebSocket documentation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)

4. Introduce a provider-neutral server model that is suitable for replication.

   PostgreSQL becomes authoritative for what Quieter presents to clients. For Gmail, confirmed mailbox state still comes from Google. Represent pending Quieter actions explicitly while they await provider confirmation.

   The model needs these records:

   | Record | Important contents |
   | --- | --- |
   | Message | Stable Quieter ID, mailbox, thread, participants, timestamps, flags, labels, body reference, version |
   | Thread | Ordered message references, summary, participants, latest activity, aggregate state |
   | Label | Stable ID, display properties, provider mapping, version |
   | Mailbox overview | Capabilities, counts, access information, synchronization status |
   | Body | Immutable content version/hash, storage reference, size, format |
   | Provider mapping | Quieter IDs mapped to Gmail/managed/future provider identifiers |
   | Provider checkpoint | Opaque provider cursor, import progress, watch status, processing lease |
   | Command | Idempotency key, operation, target, acceptance and execution state |
   | Sync stream | Epoch, committed sequence, oldest replayable sequence |
   | Sync change | Versioned entity changes and tombstones for one committed batch |
   | Outbox entry | Durable work to announce a committed change |

   Existing managed-mail tables can supply the initial projection. We do not need to copy every existing table into a second schema immediately.

   Separate summary data from bodies. Lists should never contain repeated copies of a thread's HTML.

   Keep complete search functionality on the server. Moving HTML into R2 must not accidentally remove managed-mail search or break AI consumers. Retain the required search document or normalized text, and migrate existing consumers before removing old body columns.

   Private drafts, preferences, and command details belong in a user-scoped stream when they are not shared mailbox data. Stream boundaries must match access boundaries.

5. Make the database commit and change log inseparable.

   A replicated change, its version, its log entry, and its pending delivery record must commit in the same PostgreSQL transaction.

   For a mailbox change, the server:

   - Locks that mailbox's stream row.
   - Validates the current processing lease or command state.
   - Updates messages, threads, labels, and affected aggregates.
   - Increments the mailbox sequence.
   - Appends a change batch with final entity values.
   - Records the outbox work.
   - Commits.

   Sequence allocation must follow this transaction discipline. A standalone `bigserial` event ID is insufficient as a committed checkpoint. A transaction with a larger allocated ID can commit before a smaller one.

   Every writer must use the same commit path, including ingestion, actions, rules, AI enrichment, delivery receipts, and maintenance. Provider API calls and R2 uploads happen outside the database transaction.

   Use per-mailbox ordering. There is no requirement to establish a global order between unrelated mailboxes. Transactions touching multiple streams acquire their locks in a consistent order.

   PostgreSQL's transaction and locking semantics support this design, provided all writers follow it. [Transaction isolation](https://www.postgresql.org/docs/current/transaction-iso.html), [explicit locking](https://www.postgresql.org/docs/current/explicit-locking.html)

   Events carry final values and entity versions. For example, transmit the resulting unread count, rather than an instruction to increment it. Duplicate delivery then cannot inflate counters.

6. Use immediate notification backed by durable recovery.

   After PostgreSQL confirms the commit, the request immediately sends the exact committed change batch, including its stream epoch and sequence, to the relevant `MailboxSync` object. The application already has this payload from the write path. The DO forwards it without another PostgreSQL read on the normal delivery path.

   Persist the batch in the change log and send that same batch to the DO. Do not construct a different event from pre-commit input or announce it before the transaction succeeds. A failed transaction must never produce a committed incoming-mail event in the browser.

   Concurrent requests can commit in order but reach the DO out of order. The DO tracks sequence progress, ignores duplicates, and buffers later batches within a bounded window. It retrieves missing batches from the durable log when needed before delivering them in order. PostgreSQL reads remain necessary for gaps, recovery, cold state restoration, and client catch-up.

   The outbox remains pending until the Durable Object has durably accepted responsibility. If the request crashes after committing, an outbox recovery worker performs the missing notification.

   The same principle applies between `MailboxSync` and `UserSync`. An acknowledgement means the receiving object has retained enough information to resume delivery after hibernation or failure.

   Three mechanisms cover different situations:

   - Immediate calls carry committed change batches directly to the DO for normal low latency.
   - Queues and Durable Object alarms retry known pending work.
   - A bounded maintenance sweep discovers abandoned work and repairs failed scheduling.

   Queues deliver at least once, so all consumers must tolerate duplicates. Their default batching can also introduce a five-second wait. Incoming-mail processing should explicitly use zero batching delay; bulk imports can use larger batches. [Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [batching configuration](https://developers.cloudflare.com/queues/configuration/batching-retries/)

   Polling is absent from normal client delivery, while recovery still works when a notification fails.

7. Define a small, versioned synchronization protocol.

   Use WebSocket for the first transport. It fits ordered patches and the existing Cloudflare implementation. Body downloads run independently over HTTPS, keeping large content transfers out of the control stream.

   The protocol remains transport-independent so WebTransport can be evaluated later without redesigning synchronization.

   | Message | Purpose |
   | --- | --- |
   | `HELLO` / `RESUME` | Authenticate the session and present saved checkpoints |
   | `SUBSCRIBE` / `UNSUBSCRIBE` | Set mailbox interests and subscription generations |
   | `SNAPSHOT` | Establish a bounded baseline at a known checkpoint |
   | `PATCH` | Apply an ordered batch of entity changes |
   | `ACK` | Confirm application through a checkpoint |
   | `COMMAND` / `COMMAND_RESULT` | Submit an action and report its progress |
   | `RESET_REQUIRED` | Request a new baseline when replay is unavailable |
   | `REVOKED` | Remove access and invalidate that subscription |
   | Heartbeat | Detect a dead connection and advertise current stream heads |

   Each patch identifies its protocol version, stream, epoch, subscription generation, and sequence range. IDs and large sequence values travel as strings.

   Start with JSON and bounded frames, approximately 256 KiB maximum. Keep attachments out of frames. Large atomic batches can be chunked and staged, then applied when complete.

   Clients maintain a bounded acknowledgement window. A slow client stops receiving additional payloads once it reaches that limit; the server retains its pending head and resumes through replay.

   The client applies records, tombstones, and its checkpoint in one IndexedDB transaction, then acknowledges. Duplicate batches are harmless. Missing ranges trigger replay.

   HTTPS bootstrap, replay, commands, and emergency polling use the same protocol rules and reducers.

8. Treat synchronization progress and downloaded coverage as separate concepts.

   This distinction makes a bounded cache correct:

   - A checkpoint answers: "Which changes have I processed?"
   - Coverage answers: "Which messages, query ranges, and body versions do I actually have?"

   A client can be fully current while retaining only a small fraction of the archive.

   Initial startup authenticates, restores the local working set, and resumes from its saved checkpoint. On a first visit or expired checkpoint, the server creates a bounded snapshot.

   That snapshot must contain rows and stream head `N` from the same short, repeatable-read database transaction. The client installs that baseline and applies changes after `N`. Uploading snapshot chunks to R2 happens after the database read completes.

   Archive pages and search results are additional range snapshots. They must not advance the whole mailbox checkpoint simply because they were read at a newer sequence.

   A range snapshot must also be reconciled with subsequent changes before being declared current. Otherwise, a delayed search response can resurrect a deleted message or overwrite a newer label change. Retain the necessary intervening deltas/tombstones, request replay, or restart the range if that history is unavailable.

   Start with fixed subscription types: mailbox overview, mailbox metadata, and requested content ranges. Expanding coverage requires a baseline for that scope. We do not need arbitrary SQL subscriptions in the first protocol.

   Initially retain up to roughly 14 days of replay, subject to a storage budget. Publish the actual replay floor. Older clients obtain a fresh working-set snapshot while preserving drafts and unresolved commands.

   This follows the useful part of Linear's approach: durable application changes, checkpoints, and controlled bootstrap. Its scale-specific infrastructure is unnecessary for our first implementation. [Linear's delta-sync design](https://linear.app/now/rebuilding-delta-sync-read-path)

9. Consolidate Gmail into one synchronization adapter.

   The current code has a broader UI delta path and an additions-focused background processing path. Those become one authoritative provider synchronization pipeline.

   The adapter:

   - Treats Pub/Sub notifications as hints that history should be consumed.
   - Coalesces repeated notifications for a mailbox.
   - Reads message additions, deletions, and label additions/removals.
   - Fetches and normalizes changed messages.
   - Commits the resulting changes through the shared service.
   - Advances its provider checkpoint only after the relevant changes are durable.

   A notification's history ID must never directly fast-forward our saved checkpoint.

   Gmail label definitions also need reconciliation because names, colors, and other settings do not all fit the message-history path.

   Keep basic synchronization independent of AI automation and its entitlement gates. Incoming mail should appear before optional enrichment finishes.

   New messages receive high-priority body fetching. Initial account connection loads recent mail first, then backfills archive metadata and text/HTML bodies under explicit quota and concurrency budgets. Imported bodies remain available in R2, reducing future dependence on a Google request when opening old mail.

   If Gmail history expires, repair the full metadata inventory in resumable stages. A seven-day recovery window alone cannot discover an old message that was deleted or relabeled.

   Google recommends renewing watches daily and documents delayed or dropped notifications and expired history. Periodic server reconciliation is therefore required even with a healthy WebSocket. [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push), [Gmail synchronization](https://developers.google.com/workspace/gmail/api/guides/sync)

10. Connect managed delivery and future providers to that same pipeline.

    For managed incoming mail:

    - Preserve the existing SES receipt and raw-message storage path.
    - Parse the message and establish its immutable body storage.
    - Commit the message, thread, labels, counts, and sync event together.
    - Immediately notify connected clients.
    - Run slower enrichment afterward, emitting additional changes when ready.

    Apply fast, deterministic routing rules before the first visible state when practical. AI processing must not delay ordinary delivery.

    Existing duplicate protection, raw-message recovery, attachment metadata, and object cleanup remain part of this pipeline. Failed uploads or interrupted database writes must leave recoverable work or collectible orphan objects.

    Future adapters implement provider operations behind the same contracts:

    | Provider | Adapter responsibilities |
    | --- | --- |
    | Gmail | Pub/Sub, history cursors, watches, provider mutations |
    | Managed mail | Receipt ingestion, database mutations, send feedback |
    | Outlook | Graph notifications, delta tokens, immutable identifier mappings |
    | IMAP | Folder identities, UIDVALIDITY, UIDs, supported MODSEQ/QRESYNC behavior, connection management |

    IMAP may require a dedicated service for sustained provider connections. That decision can be made when implementing the adapter; it does not change the browser protocol.

    Provider identifiers remain mappings. An RFC `Message-ID` is not a reliable globally unique database key. [Outlook immutable IDs](https://learn.microsoft.com/en-us/graph/outlook-immutable-id), [IMAP synchronization extensions](https://www.rfc-editor.org/rfc/rfc7162.html)

11. Make mutations durable, ordered commands with explicit outcomes.

    Operations express intent: `setRead(true)`, add/remove labels, move, archive, delete, save a draft, send. Avoid ambiguous operations such as "toggle."

    A command includes its mailbox, stable idempotency key, arguments, and any required base revision. Reusing an idempotency key with different arguments must be rejected.

    The action lifecycle is:

    1. Apply a local optimistic overlay.
    2. Persist the pending command before transmission.
    3. Server validates and durably accepts it.
    4. Shared clients receive the resulting effective state.
    5. The provider adapter executes it.
    6. Confirmation or failure reconciles the pending state.

    Keep observed provider state separate from outstanding intent for affected fields. An older Gmail observation must not undo an archive operation that is still being processed.

    For concurrent changes, merge independent fields where possible. Conflicting scalar operations follow server acceptance order. Use revision conflicts for destructive or whole-document edits.

    Failure removes or corrects the failed intent; it must not restore an entire stale query-cache snapshot over newer changes.

    Drafts use stable Quieter IDs and revision checks. A conflicting edit from another device should produce a recoverable conflict rather than silently overwrite content.

    Sending retains the existing [durable send state machine](../packages/orpc/src/mail-send.ts). Provider acceptance, delivery, bounce, and an unknown submission outcome are distinct states. An uncertain timeout must not cause an automatic duplicate send.

    This provides resilience during brief disconnections and reloads. When already known to be offline, remote actions can be unavailable while cached reading and draft preservation continue.

12. Store a useful working set locally, with explicit budgets.

    | Data | Persistent browser storage | Memory |
    | --- | --- | --- |
    | Mailboxes, labels, capabilities, counts | Small authorized metadata set | Current values |
    | Message/thread summaries | Bounded indexed working set | Active lists and nearby rows |
    | Senders and participant information | Bounded normalized records | Current working set |
    | HTML/text bodies | Compressed, versioned bodies within budget | Decompressed bodies likely to open next |
    | Attachment metadata | Yes | As needed |
    | Attachment files | No automatic caching | Explicit viewing/upload only |
    | Drafts and unresolved commands | Preserved separately from evictable mail | Active edits and optimistic state |
    | Checkpoints and coverage | Yes | Active subscriptions |

    The initial desktop budget is approximately 200 MB across all mailboxes, with a normal adaptive range around 100-250 MB. Mobile web starts around 75-100 MB.

    Future native apps can use the same cache policy interface with a larger allowance, potentially 500 MB-1 GB. A 1 GB browser default is not part of this plan.

    Allocate storage by usefulness rather than a fixed number of days. A five-year-old message currently being read should outrank a recent message the user has never approached.

    Evict recomputable bodies and distant list ranges first. Preserve active drafts and unresolved actions. Avoid storing raw HTML, sanitized HTML, plain text, and repeated thread copies without a reason.

    Browser quota estimates are approximate, and storage may be evicted. Handle quota failures by shrinking the cache or falling back to a session-only replica. A cache failure must not make the mailbox unusable. [Browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)

13. Make prefetching part of the engine's scheduler.

    The scheduler prioritizes:

    1. The currently opening message and visible thread.
    2. Newly arrived mail.
    3. Visible list rows.
    4. The next two or three screens and likely keyboard-navigation neighbors.
    5. The first search results and newly loaded archive pages.
    6. Frequently revisited conversations.
    7. Remaining background warming.

    Hover or pointer intent can improve priority, but it is too late to be the primary mechanism.

    Search and archive responses should start body hydration immediately. The usual sequence becomes "results arrive, bodies prepare, user clicks."

    Small new-message bodies can accompany the change batch when they fit. Larger bodies use high-priority HTTPS downloads. Body references include immutable versions so a late download cannot replace newer content.

    Downloads need deduplication, cancellation, concurrency limits, and fairness between mailboxes. Background imports must yield to visible content and new mail.

    Prefetching must not mark a message read, fetch tracking pixels, or automatically download attachments.

    Preparation also includes rendering work. The current [mail HTML processing](../apps/web/src/features/message-thread/domain/mail-html.ts) uses DOM APIs, so it cannot simply be moved wholesale into a Web Worker. Run network, persistence, and compression work off the main thread; schedule DOM-dependent sanitization and preparation in bounded idle work before navigation.

    Prepared output needs a sanitizer/rendering version. Large threads should render progressively so a local cache hit does not turn into a long main-thread stall.

14. Keep the client active across navigation, and recover cleanly across browser lifecycle changes.

    Synchronization should no longer depend on the current folder, a search being open, compose state, or whether the tab has focus.

    The client continues receiving permitted updates while the browser allows it. On focus, reconnect, or restoration, it checks stream heads and resumes immediately.

    Browsers can freeze or discard background pages, so "background synchronized" cannot mean continuously executing after the browser suspends us. Server ingestion continues independently; clients catch up when they return. [Chrome's page lifecycle documentation](https://developer.chrome.com/docs/web-platform/page-lifecycle-api)

    Target one connection owner per browser profile using a SharedWorker where suitable, with an elected-tab fallback. BroadcastChannel distributes committed changes to other tabs.

    Leadership needs expiry and fencing so a frozen tab cannot block another tab forever. Temporary duplicate connections must remain safe through normal protocol idempotency.

    Implement independent, correct per-tab sessions first. Shared connection ownership is an optimization after replay and persistence work.

    On startup, resolve the account identity before exposing persisted content. On logout or account change, invalidate active generations, abort pending work, notify other tabs, close connections, and clear the appropriate cache. Late downloads must not recreate data after cleanup.

15. Organize the implementation around existing package boundaries.

    | Location | Planned responsibility |
    | --- | --- |
    | `packages/mail` | Provider-neutral entities, operations, capabilities, search contracts |
    | New small `packages/sync` | Wire protocol, versions, checkpoint types, validation |
    | New `packages/sync-client` | IndexedDB replica, reconciliation, scheduling, transport, cache policy |
    | `packages/orpc/src/mail-sync` | Authorization, commit service, snapshots, replay, commands |
    | `packages/gmail` | Gmail API operations and normalization |
    | `packages/cloudflare` | Sync endpoint, Durable Objects, queue consumers, maintenance |
    | `packages/aws` | Managed receipts and feedback entering the shared commit path |
    | `apps/web` | TanStack Query adapters, navigation preparation, user-visible status |
    | `infra` | SST resources, bindings, queues, schedules, secrets |

    TanStack Query remains the UI's server-state interface. Its query functions and update adapters operate over the replica and request missing coverage. All confirmed changes pass through one reconciliation path.

    TanStack Store handles client workflows. It should not become another independently mutated copy of mailbox server state.

    Existing query keys remain mailbox-scoped. Gradually replace Gmail-specific query plumbing with provider-neutral names.

    Database access remains behind `@quieter/orpc`, with `withRequestDatabaseClient` for each Worker invocation. Sync replay and snapshot reads must use authoritative database state; stale caching must not manufacture missing ranges or inconsistent baselines.

16. Include access control and local-content handling in the design.

    Authorize subscriptions, snapshots, replay, body requests, and commands using the existing ownership and managed-mail grants.

    A body hash or object key must never grant access by itself. Keep R2 private and serve content through authorized requests.

    Permission changes need prompt control events that stop subscriptions and purge affected cached data in connected clients. Downloaded bytes on an offline device cannot be remotely retracted; the product must not imply otherwise.

    Keep provider credentials, token refresh, and decryption entirely server-side. Continue using SST Secret bindings and `@quieter/env`.

    Because this introduces persisted email bodies, update the existing [privacy copy](../apps/web/src/routes/privacy.tsx) before release. Expose storage usage, clear-cache controls, and an option to avoid persistent mail storage on a shared device.

    Telemetry must contain counts, timings, and bounded diagnostic categories, without message content, addresses, search text, or mailbox/user identifiers in analytics. Unexpected errors go to Sentry with appropriate filtering.

17. Make operational limits and recovery visible.

    Monitor the system at each boundary:

    | Measurement | What it reveals |
    | --- | --- |
    | Provider-event age | Provider ingestion or processing delay |
    | Queue age and retry volume | Saturated or failing workers |
    | Oldest pending outbox entry | Committed changes waiting for delivery |
    | Committed head versus client checkpoint | Actual client synchronization lag |
    | Body-ready rate before clicks | Whether prefetching delivers the intended UX |
    | Click-to-render latency | Rendering problems despite cache hits |
    | Cache bytes, evictions, quota failures | Whether storage defaults are appropriate |
    | Command acceptance and provider completion | Actions that appear successful but remain unresolved |
    | Snapshot/reset frequency | Replay retention or client correctness problems |

    Give incoming changes and user actions their own processing capacity. Backfills, AI work, and repairs should not exhaust it.

    Use bounded provider concurrency, coalesced mailbox jobs, and fenced processing leases. Database-local leases do not coordinate development and production when both touch the same Gmail account.

    Cloudflare costs depend primarily on active connections, fanout, queue jobs, and object/database operations. PostgreSQL cost depends on projection writes, replay volume, and retained log size. R2 cost depends on imported body bytes and access patterns.

    Measure cost per active mailbox and per synchronized message during the canary. A reliable monthly estimate needs those volumes; a generic infrastructure price estimate would be misleading.

18. Roll it out through complete, reviewable milestones.

    | Milestone | Deliverable | Completion condition |
    | --- | --- | --- |
    | 1. Contracts and correctness model | Entities, command states, protocol, checkpoint and coverage rules | Deterministic reference model demonstrates the intended behavior |
    | 2. Shared commit path | Stream sequencing, change log, outbox, snapshots and replay | No committed replicated change can escape durable replay |
    | 3. Managed-mail vertical slice | Incoming receipt to commit to socket to persisted body to UI | Two clients receive new mail; reopening/reconnecting recovers correctly |
    | 4. Gmail projection | Unified history processing, initial import, renewal, repair | Gmail additions, deletions, external edits, and label changes converge |
    | 5. Commands and delivery | Read/archive/labels, drafts, sending, delivery feedback | Retries and concurrent devices preserve intent without duplicate sends |
    | 6. Client performance | Prefetch scheduler, memory preparation, bounded eviction, list adapters | Cache-hit and navigation targets hold on representative mailboxes |
    | 7. Lifecycle and access | Multi-tab ownership, restoration, revocation, storage controls | Browser suspension and access changes behave predictably |
    | 8. Canary and migration | Gradual enablement, operational dashboards, rollback path | Correctness, latency, and resource use meet release criteria |
    | 9. Legacy retirement | Remove obsolete polling, dirty notifications, and localStorage mail persistence | The custom engine owns all migrated mail flows |

    Schema changes use expand/contract migrations. Existing reads continue while projections are populated and compared.

    Shadow operation can compare results, but must not execute provider mutations, send mail, or run automation twice. Each mailbox has one explicit provider-processing owner.

    During rollout, compatibility query endpoints should read the new projection where needed. A UI rollback must not reactivate a competing provider writer.

    Keep old managed body columns until search, AI, rendering, and cleanup consumers have moved. Remove transitional paths after parity is established.

19. Test failure behavior as thoroughly as normal delivery.

    The most valuable tests are sequences of changes and interruptions:

    - Duplicate, missing, delayed, and reordered notifications.
    - A database commit followed by a crash before notification.
    - Durable Object hibernation between accepting and delivering work.
    - Client termination before or after its IndexedDB commit.
    - Snapshots racing with additions, deletions, and label changes.
    - Delayed search results attempting to restore deleted data.
    - Expired replay checkpoints and Gmail history.
    - Backfills racing with live updates.
    - Concurrent actions and draft edits from multiple devices.
    - Unknown send outcomes and provider retries.
    - Access revocation, logout, account switching, and late responses.
    - Storage pressure, eviction, unavailable persistence, and frozen leaders.

    Use a deterministic reference model to compare expected server and client state after generated action sequences.

    Browser performance fixtures should cover small mailboxes, roughly 50,000-message archives, and larger synthetic archives, including long threads and large HTML messages.

    Extend the existing `vp dev:full`, fixture, and native Worker testing setup. Use real local Durable Objects and Queues, plus deterministic provider fixtures.

    Keep shared Gmail development in observation mode. Real provider-write testing requires a dedicated test mailbox or an explicit ownership handoff. Heavy tests must use disposable test infrastructure rather than load or reset the shared development database.

    Implementation verification includes focused sync tests, relevant deployment-boundary and bundle checks, `vp check --fix`, and `vp test`. Documentation must cover startup, bindings, secrets, fixtures, failure inspection, and recovery.

20. Keep the first release focused enough to finish.

    The first release fully supports Gmail and managed mail through this engine, including bodies, actions, drafts, delivery status, and recovery.

    Later extensions include Outlook, IMAP connection services, larger native-app caches, additional replicated settings, and transport experiments. Full offline workflows and collaborative text editing are outside the first release.

    This is a substantial architecture change. The difficult work is ordering, partial-cache correctness, provider reconciliation, and migration. Estimate the remaining schedule after the managed-mail vertical slice has proven those foundations.

    The first implementation milestone should be one complete managed-mail path: receive a message, persist its body, push its changes to two open clients, open it without a fetch, disconnect one client, change the message, reconnect, and recover the correct state.

This document records the original design and its targets. Production migrations, deployment, and provider-write canaries still require the protected rollout described in the implementation document. Performance targets are not production guarantees.
