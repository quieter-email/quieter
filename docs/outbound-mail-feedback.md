# Outbound mail feedback

Quieter publishes outbound delivery events from the configured mail provider to an SNS topic and processes them with an AWS function. Lambda retries failed processing twice before moving the failed asynchronous invocation to a 14-day SQS dead-letter queue. The dead-letter queue has no active consumer and therefore creates no idle polling traffic.

The processor stores an immutable, idempotent event for each recipient and a current recipient-level delivery projection. Hard bounces, complaints, and unsubscribes also create an organization-scoped suppression. Both application-managed mail and organization API sends check that suppression before contacting the mail provider.

## Event model

Each stored event carries a normalized type: `queued`, `sent`, `delivered`, `delayed` (transient failure), `bounced` (hard bounce), `rejected`, `complained`, `opened`, or `unsubscribed`. Events are immutable and deduplicated by a hash over provider, source event id, provider message id, event type, and recipient, so duplicate notifications and replays never create duplicate timeline entries.

The recipient delivery projection advances monotonically from queued to sent, delayed, and delivered. Rejected, bounced, and complained outcomes take precedence, in that order. Equal timestamps and out-of-order notifications produce the same status; `lastEventAt` is the latest delivery event time. Open and unsubscribe events remain in the timeline but do not replace a delivery outcome.

Provider reason strings, diagnostic codes, and provider status are retained as technical evidence. They are escaped when displayed, but their content comes from the provider.

## Suppression

A complaint suppresses immediately and must not be retried. A permanent bounce suppresses. An unsubscribe suppresses. A transient bounce or delivery delay is recorded without suppressing. Rejects are terminal for the message but do not create a local suppression.

Organization admins can block an address manually or unblock it from organization settings. Every suppression change, automatic or manual, is written to an audit history with action, reason, actor, and timestamp. Manual blocks never downgrade an active automatic reason. Unblocking records the actor; older feedback cannot undo that decision. A subsequent manual block starts a new suppression with a manual reason.

## Reconciliation

Recipient projections can be recomputed atomically from the immutable event log. Reconciliation and ingestion serialize per organization/message, preventing concurrent feedback from being overwritten. Notifications that never arrived are repaired by replaying them through normal ingestion: event writes are idempotent, so replaying the same SNS envelope is safe.

## Operational response

- Processor exceptions are reported to Sentry. The dead-letter alarm indicates an event exhausted its retries.
- Before replaying a dead-letter invocation, confirm the database and configuration set are available.

## Open tracking

Open tracking is disabled until an organization admin enables it in team settings, optionally letting authorized API senders opt out per send; without that allowance the team setting applies to every message. When active, html messages sent through the organization API or managed compose include a signed marker carrying only the Quieter message header id.

Marker loads are verified by signature, resolved back to the outbound message, and recorded as bounded engagement signals:

- One row per message with a capped count of reported loads. Repeat loads can increase that count; they never create repeated timeline entries.
- Only unambiguous single-recipient sends also record a recipient-level `opened` event on the normalized timeline; batched sends record the open for the message because one copy goes to every recipient.
- Opens are approximate. Privacy proxies pre-fetch images, caches can serve or swallow markers, some clients block images entirely, and automatic tools can trigger loads. An open never proves a person read a message.
- Disabling tracking stops markers on future sends and leaves historical reporting untouched.

The public API exposes recipient delivery history at `GET /api/v1/messages/{messageId}` and active suppressions at `GET /api/v1/suppressions`. The TypeScript SDK wraps these as `getMessage` and `listSuppressions`.

## Reporting and verification

Dashboard counts are distinct message-recipient pairs for each event type observed during the selected period. They are activity counts, not delivery rates for a cohort of sent messages. Opened-message counts use the same mailbox filter and count messages, not recipients. Queued and unsubscribe event contracts are available for future producers; there is no unsubscribe endpoint in this change.

Run `vp test packages/orpc/tests/organization-mail-delivery.integration.test.ts` with `MIGRATION_TEST_DATABASE_URL` pointing to a migrated loopback `quieter_migration_test` database. CI runs this after migration integration tests. The suite checks real SQL conflict updates, duplicates, reconciliation, suppression history, ownership, and open attribution.
