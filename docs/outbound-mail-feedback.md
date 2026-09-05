# Outbound mail feedback

Quieter publishes outbound delivery events from the configured mail provider to an SNS topic and processes them with an AWS function. Lambda retries failed processing twice before moving the failed asynchronous invocation to a 14-day SQS dead-letter queue. The dead-letter queue has no active consumer and therefore creates no idle polling traffic.

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

- Processor exceptions are reported to Sentry. The dead-letter alarm indicates an event exhausted its retries.
- Before replaying a dead-letter invocation, confirm the database and configuration set are available.

## Open tracking

Open tracking is disabled until an organization admin enables it in team settings, optionally letting authorized senders opt out per send; without that allowance the team setting applies to every message. When active, html messages sent through the organization API or managed compose include a signed marker carrying only the Quieter message header id.

Marker loads are verified by signature, resolved back to the outbound message, and recorded as bounded engagement signals:

- One row per message with a capped counter, so duplicate loads, retries, and caches never inflate history.
- Only unambiguous single-recipient sends also record a recipient-level `opened` event on the normalized timeline; batched sends record the open for the message because one copy goes to every recipient.
- Opens are approximate. Privacy proxies pre-fetch images, caches can serve or swallow markers, some clients block images entirely, and automatic tools can trigger loads. An open never proves a person read a message.
- Disabling tracking stops markers on future sends and leaves historical reporting untouched.

The public API exposes recipient delivery history at `GET /api/v1/messages/{messageId}` and active suppressions at `GET /api/v1/suppressions`. The TypeScript SDK wraps these as `getMessage` and `listSuppressions`.
