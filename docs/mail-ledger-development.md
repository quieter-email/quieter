# Durable mail ledger development

The new ledger is dormant. No public route, scheduled handler, queue consumer, or existing v1 send path calls it yet. These additive migrations can precede runtime activation. Async acceptance must stay disabled until payload preparation, billing limits, the sender, feedback processing, status retrieval, and controlled end-to-end tests are complete.

## Transaction boundaries

`@quieter/database/mail-acceptance` writes the original queued result, submission, usage reservation, and dispatch outbox in one transaction. It shares the existing organization advisory lock. Callers authenticate before preparing content, then recheck authorization through the supplied transaction even on a replay. Budget checks run only for new acceptance and must include outstanding reservations. The callbacks may perform database work only. Uploads and external policy services run before the transaction. Idempotency reads occur inside the authoritative transaction; a lost commit response is reconciled with the same organization/key.

Payload bodies remain in PostgreSQL. Attachments use private immutable object references with byte counts and checksums. The acceptance caller must validate ownership and prepare these objects before committing. Upload leases and orphan cleanup are still an activation prerequisite. JSON checksums use canonical property ordering so PostgreSQL's JSON representation does not change content identity.

`@quieter/database/mail-outbox` claims bounded due batches with `FOR UPDATE SKIP LOCKED`, increments the claim generation, and publishes after releasing the transaction. Publication receipts and failures are written only for the matching owner/generation. The queue adapter must enforce a ten-second request deadline. A lost response can create duplicate delivery with the same event ID. Consumers must deduplicate through ledger state.

Recovery re-enqueues queued submissions even after an earlier queue publication succeeded. It preserves event identity and invalidates stale publishers. `sendAfter` controls safe send timing; `nextActionAt` controls the next recovery check. Recovery must not postpone valid sends by changing their eligibility time.

`@quieter/database/mail-attempts` records a provider-call intent before the sender may contact SES. Concurrent delivery cannot create another unresolved attempt. An expired intent becomes `pending_confirmation`, preserving its reservation. It never returns to the send queue because a lease elapsed. Late confirmed success updates the existing attempt, finalizes its reservation, and writes the accepted projection event atomically. Only a definitive rejection may release the reservation or schedule a bounded safe retry. The sender must disable automatic SDK retries and enforce provider quota and deadline checks before its external call.

`@quieter/database/mail-feedback-inbox` retains authenticated feedback without requiring a provider-message mapping. The intake adapter must validate the configured source before calling it. Repeated identities must match canonical content and schema metadata. The later projection transaction must apply dedupe and delivery changes together; intake alone does not mark feedback applied.

The dormant `@quieter/mail/ses-submission-transport` adapter uses one SDK attempt and a ten-second deadline. It requires an explicit regional feedback configuration set, adds opaque `quieter_submission` and `quieter_attempt` tags, and rejects customer tags in the reserved namespace. Only documented service rejections count as a definite failure. A transport error, server error, or successful response without a valid message ID stays unknown. HTTP-handler tests exercise the installed AWS SDK's retry behavior without sending email. See [SESv2 SendEmail responses and errors](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html).

## Retention and remaining integration

Idempotency retention is at least seven days. Nonterminal and unknown work needs longer retention. No cleanup currently deletes these records. Submission ownership uses restrictive foreign keys, so accepted work cannot disappear through organization or mailbox deletion. Before activation, deletion handlers need an explicit drain/cancel/retention procedure for this ownership constraint.

`@quieter/billing/mail-submission-usage` reserves confirmed usage plus outstanding reservations under the shared billing lock. Its entitlement reads use the acceptance transaction and reject stale billing state without contacting Polar; the caller refreshes billing before entering the transaction. Confirmed sends finalize their reservation and write usage and billing events in the same transaction. Final charges use confirmed usage and the retained credit allowance, so an earlier failed reservation cannot consume included credit. Unknown sends retain their reservations.

Polar reporting must preserve delayed confirmation across billing-period boundaries. The existing v1 path must account for reservations before both paths operate together. The SDK contract, HTTP 201 versus replay 200, send-time suppression policy, quota reservation, signed feedback correlation, and scheduled recovery wiring remain disabled integration work.

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
vp test packages/database/tests/mail-outbox.integration.test.ts packages/billing/tests/mail-submission-usage.integration.test.ts
```

The migration test deliberately resets this disposable database. Both test entry points reject non-loopback hosts and require the exact `quieter_migration_test` database. Never point them at shared development. Stop and remove the fixture after testing:

```powershell
wsl -d Ubuntu -u root -- docker stop quieter-release-ledger-test
```

The PostgreSQL tests cover concurrent acceptance, transaction failure, separate outbox claims, generation fencing, queue-loss recovery, unknown sends, late confirmation, safe retry accounting, feedback before mapping, and restrictive ownership. CI runs these after migrating its disposable PostgreSQL service.
