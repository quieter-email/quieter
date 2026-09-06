# Durable mail ledger development

The new ledger is dormant. The outbox publisher has queue and scheduled entrypoints, but infrastructure does not activate them yet. No public route or existing v1 send path calls the ledger. These additive migrations can precede runtime activation. Async acceptance must stay disabled until runtime wiring, feedback processing, status retrieval, capacity refresh, and controlled end-to-end tests are complete.

## Transaction boundaries

`@quieter/database/mail-acceptance` writes the original queued result, submission, usage reservation, and dispatch outbox in one transaction. It holds a `FOR NO KEY UPDATE` lock on the organization row, shared with credit accounting and mail settlement. Callers authenticate before preparing content, then recheck authorization through the supplied transaction even on a replay. Budget checks run only for new acceptance and must include outstanding reservations. The callbacks may perform database work only. Uploads and external policy services run before the transaction. Idempotency reads occur inside the authoritative transaction; a lost commit response is reconciled with the same organization/key.

Payload bodies remain in PostgreSQL. `@quieter/orpc/mail-submission-payload` validates and prepares attachments under server-created upload leases. The private R2 adapter writes conditionally and verifies every object's size and checksum. Prepared payloads preserve inline attachments, repeated headers, metadata, and tracking. The sender verifies content again before creating a provider-call intent. JSON checksums use canonical property ordering so PostgreSQL's JSON representation does not change content identity.

`@quieter/database/mail-payload-uploads` tracks ten-minute preparation leases. Acceptance locks the ready lease, verifies organization ownership and the exact manifest, then commits its ownership with the submission. Cleanup locks expired uncommitted leases before deleting objects outside the transaction. It retries failures and retains cleanup records for daily revisits, including storage calls that finish late. A cleanup claim permanently prevents late acceptance; committed objects are excluded. No object lifecycle rule may delete accepted payloads. The scheduled cleanup entrypoint and production private bucket binding remain activation prerequisites.

`@quieter/database/mail-outbox` claims bounded due batches with `FOR UPDATE SKIP LOCKED`, increments the claim generation, and publishes after releasing the transaction. Publication receipts and failures are written only for the matching owner/generation. The queue adapter must enforce a ten-second request deadline. A lost response can create duplicate delivery with the same event ID. Consumers must deduplicate through ledger state.

Recovery re-enqueues queued submissions even after an earlier queue publication succeeded. It preserves event identity and invalidates stale publishers. `sendAfter` controls safe send timing; `nextActionAt` controls the next recovery check. Recovery must not postpone valid sends by changing their eligibility time.

`@quieter/database/mail-attempts` records a provider-call intent before the sender may contact SES. Concurrent delivery cannot create another unresolved attempt. An expired intent becomes `pending_confirmation`, preserving its reservation. It never returns to the send queue because a lease elapsed. Late confirmed success updates the existing attempt, finalizes its reservation, and writes the accepted projection event atomically. Only a definitive rejection may release the reservation or schedule a bounded safe retry. The sender must disable automatic SDK retries and enforce provider quota and deadline checks before its external call.

`@quieter/database/mail-feedback-inbox` retains authenticated feedback without requiring a provider-message mapping. The intake adapter must validate the configured source before calling it. Repeated identities must match canonical content and schema metadata. The later projection transaction must apply dedupe and delivery changes together; intake alone does not mark feedback applied.

`@quieter/orpc/mail-submission-feedback` checks the retained envelope, source account and region, correlation IDs, sender, and recipients before settling an attempt. It reuses the existing delivery and suppression rules. Settlement, delivery changes, and inbox completion share one transaction, including when feedback arrives before the sender response. Confirmed acceptance takes precedence over a later unknown transport result. Unsupported or conflicting events remain in a durable quarantine. Untagged legacy events with no projection mapping remain pending for recovery. Intake authentication, scheduled recovery, quarantine alerts, and the queue consumer still need runtime wiring.

The dormant `@quieter/mail/ses-submission-transport` adapter uses one SDK attempt and a ten-second deadline. It requires an explicit regional feedback configuration set, adds opaque `quieter_submission` and `quieter_attempt` tags, and rejects customer tags in the reserved namespace. Only documented service rejections count as a definite failure. A transport error, server error, or successful response without a valid message ID stays unknown. HTTP-handler tests exercise the installed AWS SDK's retry behavior without sending email. See [SESv2 SendEmail responses and errors](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).

`@quieter/orpc/mail-submission-sender` verifies stored content, refreshes billing outside the transaction, then rechecks billing access, sender ownership, and suppression using the attempt transaction. A permanent policy rejection releases the reservation and records a failure event without calling SES. Capacity deferrals keep work queued with a durable retry time. The sender makes one transport call per committed intent; explicit retryable rejections stop after five attempts. A failure while persisting confirmed success leaves the existing attempt unresolved, so queue redelivery cannot resend it. PostgreSQL's clock determines send eligibility.

`@quieter/database/mail-send-capacity` serializes capacity reservations with send intents. Keys identify an AWS account and region. Snapshots expire after sixty seconds; `inspectCapacity` obtains them through SES GetAccount outside database transactions. The observation time is taken before that request. The daily check includes reported usage, unresolved attempts, and confirmations since observation, conservatively double-counting overlap during the read. Rate pacing uses eighty percent of the reported rate and charges each recipient. SES remains authoritative and can throttle below its advertised maximum; this check does not reserve capacity against unrelated senders. Legacy senders and any other environment sharing the account must be coordinated before activation. See [SES regional quotas](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendQuota.html).

## Retention and remaining integration

Feedback recovery claims at most five due records from the configured source and region. Two-minute leases allow a replacement process to recover abandoned claims. Completion and retry writes check the claim generation. A failed projection transaction leaves its payload pending and schedules a one-minute retry; missing legacy mappings retry after five minutes. Quarantine is retained outside automatic retries. Recovery returns aggregate outcome counts for the future scheduled handler and alerts.

The existing synchronous senders now also disable automatic SES SDK retries and use a ten-second transport timeout. They still have their original persistence ambiguity and legacy unkeyed retries can duplicate delivery. Customer tag names beginning with `quieter_` are reserved, case-insensitively, across both contracts. This validation change is required before operational correlation tags can be trusted.

Idempotency retention is at least seven days. Nonterminal and unknown work needs longer retention. No cleanup currently deletes these records. Submission ownership uses restrictive foreign keys, so accepted work cannot disappear through organization or mailbox deletion. Before activation, deletion handlers need an explicit drain/cancel/retention procedure for this ownership constraint.

`@quieter/billing/mail-submission-usage` reserves confirmed usage plus outstanding reservations under the shared billing lock. Its entitlement reads use the acceptance transaction and reject stale billing state without contacting Polar; the caller refreshes billing before entering the transaction. Confirmed sends finalize their reservation and write usage and billing events in the same transaction. Final charges use confirmed usage and the retained credit allowance, so an earlier failed reservation cannot consume included credit. Unknown sends retain their reservations.

Acceptance checks the billing period against the database clock before committing. Polar reporting must preserve delayed confirmation across billing-period boundaries. The existing v1 path must account for reservations before both paths operate together. The SDK contract, HTTP 201 versus replay 200, mailbox-specific authorization, signed feedback correlation, capacity refresh, and scheduled recovery wiring remain disabled integration work.

## Disposable PostgreSQL verification

Use the same image as CI. On Windows with the existing Ubuntu Docker engine, keep this command running in one terminal so WSL stays active:

```powershell
wsl -d Ubuntu -u root -- docker run --rm --name quieter-release-ledger-test --publish 127.0.0.1:55432:5432 --env POSTGRES_DB=quieter_migration_test --env POSTGRES_USER=postgres --env POSTGRES_PASSWORD=postgres pgvector/pgvector:0.8.6-pg16
```

In another terminal, run the generated migration history and ledger tests:

```powershell
$env:MIGRATION_TEST_DATABASE_URL='postgresql://postgres:postgres@127.0.0.1:55432/quieter_migration_test'
vp run db:check
vp run db:test-migrations
vp test packages/database/tests/mail-outbox.integration.test.ts packages/billing/tests/mail-submission-usage.integration.test.ts packages/orpc/tests/mail-submission-sender.integration.test.ts
vp run @quieter/cloudflare#test:workers
```

The migration test deliberately resets this disposable database. Both test entry points reject non-loopback hosts and require the exact `quieter_migration_test` database. Never point them at shared development. Stop and remove the fixture after testing:

```powershell
wsl -d Ubuntu -u root -- docker stop quieter-release-ledger-test
```

The PostgreSQL tests cover concurrent acceptance, transaction failure, separate outbox claims, generation fencing, queue-loss recovery, unknown sends, late confirmation, safe retry accounting, feedback before mapping, and restrictive ownership. CI runs these after migrating its disposable PostgreSQL service.

`vp run @quieter/cloudflare#test:workers` also verifies immutable attachment writes and corruption detection against the provider's local R2 runtime. This uses the test-only `LocalMailStorage` binding and cannot access production objects.

With `MIGRATION_TEST_DATABASE_URL` set, the native Worker tests use Miniflare's supported local Hyperdrive mapping to the disposable database. They publish real native queue messages, recover a lost wakeup with the same event ID, and preserve an abandoned send attempt without another dispatch. CI runs this after the migration tests. Without that variable, only the PostgreSQL integration tests skip.

## Outbox publisher

`packages/cloudflare/src/mail-submission-publisher-worker.ts` drains at most sixty events per invocation, with five concurrent publications and a ten-second deadline per native queue request. Strict versioned contracts route dispatch events to the sender queue and accepted/failed events to the projection queue. Native queue acceptance is recorded as a receipt tied to the durable event ID. It does not claim to be a provider message ID.

A wakeup retries when publication is uncertain or a full bounded drain leaves more work. The scheduled entrypoint first recovers expired attempts and lost queued work, then drains the outbox. It reports deferred publication as a failed scheduled invocation, preserving database recovery eligibility. Infrastructure must configure its independent wake queue, schedule, dead-letter handling, and alerts before activation.

The native tests reproduced two defects in the pinned `postgres@3.4.9`: cold `reserve()` with `fetch_types:false` hangs, and the Cloudflare socket teardown emits an unhandled rejection after listeners are removed. The checked-in package patch restores the cold reservation's pool callback in all shipped JavaScript builds and guards the post-teardown error emission. Tests exercise reservation, ordinary SQL failure, pool reuse, and awaited shutdown. Remove the patch only after the same tests pass with an upstream fix. See the upstream [cold reservation report](https://github.com/porsager/postgres/issues/751) and [Worker teardown report](https://github.com/porsager/postgres/issues/1202). This patch does not repair the legacy session-lock design or certify database failover behavior; both remain part of runtime migration and failure testing.

## Admission limits

Every new acceptance requires explicit global and organization limits for pending count and combined message/attachment bytes, plus a maximum queued age. Indexed aggregates inspect at most the configured count cap (up to 10,000 rows). A short row lock on the singleton `mailAdmissionGate` serializes admission across organizations; it covers database work only. Capacity failure rolls back before reserving usage or committing an upload lease. Existing keys replay before the capacity check. Ambiguous attempts still consume count and byte capacity, but their age alone does not stop every tenant: they need reconciliation, not another send attempt.

The additive `20260906160215_large_ink` migration creates that gate. The ledger and credit accounting use transaction-held row locks because [Hyperdrive does not support advisory locks](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/). Miniflare's local connection mapping does not reproduce every hosted pooling restriction. The legacy synchronous mail lock remains an activation blocker until that path migrates to durable reservations. Do not enable both send paths on the assumption that the old session lock coordinates them.

The additive `20260906152700_sturdy_iron_patriot` migration adds the two partial indexes. Tests cover competing organizations, count/byte limits, database-clock queue age, and replay at capacity. Deployment-specific limits, orphan-upload/storage-retention budgets, and overload HTTP responses remain required before public activation. Pending limits alone do not bound the lifetime storage of completed submissions or abandoned preparations.

## Submission request identity and reads

`normalizeMailSubmissionRequest` hashes validated client intent before payload preparation. Parsed defaults, object key order, header casing, and equivalent base64 encodings share an identity. Attachment content and metadata remain significant. Repeated headers with the same name preserve their order. The key itself, generated message ID, upload location, preparation timestamp, and resolved tracking default are excluded. An explicit tracking choice remains significant. Unknown request fields are rejected so a misspelled option cannot silently become an accepted different message.

`findMailSubmissionReplay` allows an authorized retry to return its original queued result before attempting any new payload upload. Acceptance repeats the lookup inside its transaction to resolve concurrent preparations. `readMailSubmissionStatus` separately returns processing status and timestamps, scoped to the organization and exact mailbox scope. Both recheck authorization in their read transaction; neither returns message bodies, recipient addresses, provider IDs, or internal failure details. These package contracts remain dormant until the complete async runtime is enabled.
