# Outbound mail feedback

Quieter publishes outbound delivery events from the configured mail provider to an SNS topic, forwards them to a durable SQS queue, and processes them with an AWS function. The queue retries failed processing five times before moving the message to a 14-day dead-letter queue.

The processor stores an immutable, idempotent event for each recipient and a current recipient-level delivery projection. Permanent bounces and complaints also create an organization-scoped suppression. Both application-managed mail and organization API sends check that suppression before contacting the mail provider.

The configuration set intentionally publishes send, delivery, delivery delay, bounce, complaint, and reject events. Open and click tracking are not enabled.

## Operational response

- A permanent bounce suppresses the recipient. A transient bounce or delivery delay is recorded without suppressing it.
- A complaint suppresses the recipient immediately and must not be retried.
- A reject is recorded as a terminal message-recipient status but does not create a local suppression.
- Processor exceptions are reported to Sentry. The CloudWatch queue-age alarm indicates a processing backlog, and the dead-letter alarm indicates an event exhausted its retries.
- Before replaying a dead-letter message, confirm the database and configuration set are available. Event writes are idempotent, so replaying the same SNS envelope is safe.

The public API exposes recipient delivery history at `GET /api/v1/messages/{messageId}` and active suppressions at `GET /api/v1/suppressions`. The TypeScript SDK wraps these as `getMessage` and `listSuppressions`.
