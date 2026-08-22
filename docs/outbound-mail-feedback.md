# Outbound mail feedback

Quieter publishes outbound delivery events from the configured mail provider to an SNS topic, forwards them to a durable SQS queue, and processes them with an AWS function. The queue retries failed processing five times before moving the message to a 14-day dead-letter queue.

The processor stores an immutable, idempotent event for each recipient and a current recipient-level delivery projection. Hard bounces, complaints, and unsubscribes also create an organization-scoped suppression. Both application-managed mail and organization API sends check that suppression before contacting the mail provider.

## Event model

Each stored event carries a normalized type: `queued`, `sent`, `delivered`, `delayed` (transient failure), `bounced` (hard bounce), `rejected`, `complained`, `opened`, or `unsubscribed`. Events are immutable and deduplicated by a hash over provider, source event id, provider message id, event type, and recipient, so duplicate notifications and replays never create duplicate timeline entries.

The current per-recipient status is a projection of that timeline with two rules:

- Terminal outcomes are ordered by severity: complained, then bounced, then rejected, then unsubscribed. A more severe outcome escalates the status no matter when it arrives; nothing regresses an existing terminal one.
- Everything else (queued, sent, delivered, delayed, opened) follows the most recently observed event time, so out-of-order arrivals converge instead of regressing.

Provider evidence (raw reason strings, diagnostic codes, provider status) is retained on events but product surfaces present normalized labels. The evidence never includes credentials or internal infrastructure identifiers.

## Suppression

A complaint suppresses immediately and must not be retried. A permanent bounce suppresses. An unsubscribe suppresses. A transient bounce or delivery delay is recorded without suppressing. Rejects are terminal for the message but do not create a local suppression.

Organization admins can block an address manually or unblock it from organization settings. Every suppression change, automatic or manual, is written to an audit history with action, reason, actor, and timestamp. Manual blocks never downgrade an existing automatic reason while a suppression is active, and unblocking always records who did it.

## Reconciliation

Recipient projections can be recomputed from the immutable event log without touching events, which repairs projection drift. Notifications that never arrived are repaired by replaying them through normal ingestion: event writes are idempotent, so replaying the same SNS envelope is safe.

## Operational response

- Processor exceptions are reported to Sentry. The CloudWatch queue-age alarm indicates a processing backlog, and the dead-letter alarm indicates an event exhausted its retries.
- Before replaying a dead-letter message, confirm the database and configuration set are available.

The public API exposes recipient delivery history at `GET /api/v1/messages/{messageId}` and active suppressions at `GET /api/v1/suppressions`. The TypeScript SDK wraps these as `getMessage` and `listSuppressions`.

Open tracking is part of the event contract but not yet enabled end to end; see QUIETER-167.
