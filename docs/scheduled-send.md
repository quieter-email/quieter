# Scheduled sending

Scheduled messages belong to their creator and mailbox. The composer stores a complete message snapshot, including attachments, before removing the original draft. Canceling a scheduled message restores a regular draft. The Scheduled view shows pending sends and failures for the active mailbox.

## Timing and delivery

PostgreSQL owns each message's time and delivery state. Private object storage holds its immutable compose payload. Each `ScheduledSend` Durable Object holds only its authenticated scope and one alarm. The alarm calls `/api/internal/scheduled-send` on the configured `BETTER_AUTH_URL` origin. The web handler loads the current record and calls the existing provider-neutral compose sender.

The timer does not hold Gmail credentials or AWS sending permissions. Gmail refreshes encrypted owner credentials when the message is due. Managed mail uses the established permission, suppression, billing, tracking, and delivery code. Both paths use one permanent send operation ID. Delivery with an uncertain provider response is reconciled through existing receipts rather than submitted again with another ID.

Scheduled times are absolute instants. The saved named timezone controls display. Sending never starts deliberately before the saved time. Cloudflare alarms, network failures, token refresh, provider acceptance, and downstream mail delivery can delay sending. This is not an exact-second delivery guarantee.

Wake and dispatch requests use the existing linked `GMAIL_LIVE_SYNC_TOKEN_SECRET`, separate signed purposes, a short expiry, and an explicit creator, mailbox, and schedule ID. Both endpoints verify the exact body bytes with a bounded body size. The dispatch endpoint bypasses the site's password wall because its signature authenticates the request. It does not accept a caller-provided callback URL.

## Recovery

The minute maintenance worker scans only records whose `nextWakeAt` is due. It requests another durable wake after an interrupted preparation, missed alarm registration, stale execution claim, or deferred delivery reconciliation. It does not poll future messages every minute. A recovery claim moves its next repair time forward before requesting a wake, so concurrent maintenance workers do not repeatedly register the same due timer.

The Durable Object persists a recovery alarm before calling the web handler. A failed callback retains that alarm. A successful callback returns the next authoritative wake time or `null` to remove it. Cancellation and rescheduling compete with the database send claim, so an already-started send cannot report a successful cancellation.

If the original draft disappears during transfer, scheduling stops for review and keeps the saved message. This also covers a crash after deleting the draft but before recording that deletion. Cancel the failed schedule to restore a draft before trying again. A missing draft cannot prove whether another mail client sent it.

## Local development

Use the standard development setup and start the web application and local background worker with `vp run dev:full`. The ignored worker bindings include `BETTER_AUTH_URL` and the development live-update signing secret. Keep the configured web origin aligned with the port running the application. The local worker exports the same `ScheduledSend` Durable Object and uses persisted local alarms.

Create a scheduled message in the composer and cancel it from Scheduled to verify draft restoration without sending externally. `vp run dev:trigger scheduled-send` runs a bounded recovery scan through the authenticated local worker endpoint. The normal local trigger expects the background worker's default port, 8787. If a verification run uses another port, call its `/__dev/scheduled-send` endpoint with the existing local worker authorization instead.

The existing local provider isolation rules still apply. Real Gmail mutation tests require a dedicated test mailbox and explicit watch ownership. Local managed mail does not silently send through production resources. Use the focused service tests and worker alarm tests for deterministic dispatch and recovery checks.

## Rollout

Apply the additive scheduled-send database migration through the protected workflow first. Deploy the web code with the authenticated dispatch route second. Deploy the updates worker with its new `ScheduledSend` binding and appended Durable Object migration third. This order gives new alarms a reachable handler and an existing database table. Existing releases remain compatible with the added table.

Deploy the maintenance worker with its bounded repair scan. Preserve the existing Durable Object migration history and the permanent send receipts when rolling forward or back. Retained scheduled payloads remain referenced until delivery or successful draft restoration, so the regular object cleanup cannot discard future attachments.

Production migration and deployment require explicit authorization. Implementing this feature does not apply either operation.
