# Scheduled sending

Scheduled messages belong to their creator and mailbox. The composer stores a complete message snapshot, including attachments, before removing the original draft. Canceling a scheduled message restores a regular draft. The Scheduled view shows pending sends and failures for the active mailbox.

Ordinary mailbox sends use this same lifecycle with `deliveryKind = undo`. After preparation, the database saves a short hold deadline. The composer shows the hold and offers Undo send before that deadline. Undo competes with dispatch in the database and cannot succeed after the deadline. It restores the saved editable message and attachments. This is a hold before delivery, and cannot recall an accepted message. Public transactional sending remains immediate.

The underlying states `preparing`, `scheduled`, `sending`, `sent`, `failed`, `uncertain`, and `cancelled` persist the operation. Ordinary-send responses name them preparing, held, dispatching, accepted, failed, uncertain, and canceled. Retries preserve the operation ID and deadline. The Scheduled view also shows ordinary holds and any unresolved delivery or draft restoration, so closing the composer does not lose the operation. A canceled operation remains as permanent replay evidence after its payload retires.

## Timing and delivery

PostgreSQL owns each message's time and delivery state. Private object storage holds its immutable compose payload. Each `ScheduledSend` Durable Object holds its authenticated scope, the version of its latest wake, and one alarm. The alarm calls `/api/internal/scheduled-send` on the configured `BETTER_AUTH_URL` origin. The web handler loads the current record and calls the existing provider-neutral compose sender.

The timer does not hold Gmail credentials or AWS sending permissions. Gmail refreshes encrypted owner credentials when the message is due. Managed mail uses the established permission, suppression, billing, tracking, and delivery code. Both paths use one permanent send operation ID. Delivery with an uncertain provider response is reconciled through existing receipts rather than submitted again with another ID.

Scheduled times are absolute instants. The saved named timezone controls display. Sending never starts deliberately before the saved time. Cloudflare alarms, network failures, token refresh, provider acceptance, and downstream mail delivery can delay sending. This is not an exact-second delivery guarantee.

Wake and dispatch requests use the existing linked `GMAIL_LIVE_SYNC_TOKEN_SECRET`, separate signed purposes, a short expiry, and an explicit creator, mailbox, and schedule ID. Both endpoints verify the exact body bytes with a bounded body size. The dispatch endpoint bypasses the site's password wall because its signature authenticates the request. It does not accept a caller-provided callback URL.

## Recovery

The minute maintenance worker scans only records whose `nextWakeAt` is due. It requests another durable wake after an interrupted preparation, missed alarm registration, stale execution claim, or deferred delivery reconciliation. It does not poll future messages every minute. A recovery claim moves its next repair time forward before requesting a wake, so concurrent maintenance workers do not repeatedly register the same due timer.

A send that cannot start because credential refresh temporarily fails remains scheduled for retry with its original operation ID. Once submission may have started, recovery keeps the message reserved until the existing delivery receipts establish the outcome.

Composer recovery first looks for the saved schedule. If the recovered files are missing or the send time has expired, an atomic recovery request either returns the existing schedule or permanently fences the absent attempt. Creation checks that fence in the same transaction as its final insert. Only a confirmed abandoned attempt unlocks editing and receives a new operation ID, so an older request cannot later schedule an incomplete copy.

The Durable Object persists a recovery alarm before calling the web handler. A failed callback retains that alarm. A successful callback returns the next authoritative wake time or `null` to remove it. Cancellation and rescheduling compete with the database send claim, so an already-started send cannot report a successful cancellation.

The callback wait runs outside the Durable Object's short state gates and allows the provider's full send budget. A new wake can arrive while dispatch is pending. An older callback can only update the timer if the stored wake version still matches, so it cannot erase or delay newer work.

If the original draft disappears during transfer, scheduling stops for review and keeps the saved message. This also covers a crash after deleting the draft but before recording that deletion. Cancel the failed schedule to restore a draft before trying again. A missing draft cannot prove whether another mail client sent it.

## Assistant-held drafts

The composer bridge accepts held-send receipts separately from saved-draft receipts. A held receipt carries the current mailbox, the composer's local draft identity and revision, and its permanent send operation ID. The restored draft ID identifies the server draft returned by cancellation. It never replaces the local identity used to match receipts.

The existing held-send query owns status, the deadline and `canUndo`. Receipt admission freezes the matching composer without replacing its visible content. Repeated updates for the same operation remain valid after local revision changes. Successful cancellation loads and prepares the complete restored draft before making the composer editable with a fresh operation ID. A canceled result without an available restored draft stays read-only for retry. A definitively abandoned, never-admitted operation restores its local snapshot instead.

Actions waiting for a save or attachment loading retain their original draft identity and revision. They recheck ownership before sending, closing, navigating or changing senders. Undo invalidates those continuations so an older Send cannot resume with the restored draft's new operation ID.

If visible edits raced the assistant's send request, the held recovery record retains that fact. Those edits stay under the original uncertainty fence while delivery is pending. After authoritative cancellation or acceptance, the composer saves a separate local recovery copy before replacing or closing the held draft. The copy has a stable identity derived from the original operation, so retrying preservation does not overwrite a newer recovery copy. Storage ownership or persistence failures keep the original visible draft available for retry.

Assistant proposals remain local until explicit human Save draft or Send intent. Typing, reminders, autosave, closing, navigation and sender transfer preserve proposal ownership. They do not implicitly save or delete its server draft. A later assistant edit reasserts this protection even if an earlier save completes. Local recovery remains scoped to its current user, session and mailbox.

## Local development

Use the standard development setup and start the web application and local background worker with `vp run dev:full`. The ignored worker bindings include `BETTER_AUTH_URL` and the development live-update signing secret. Keep the configured web origin aligned with the port running the application. The local worker exports the same `ScheduledSend` Durable Object and uses persisted local alarms.

Create a scheduled message in the composer and cancel it from Scheduled to verify draft restoration without sending externally. `vp run dev:trigger scheduled-send` runs a bounded recovery scan through the authenticated local worker endpoint. The normal local trigger expects the background worker's default port, 8787. If a verification run uses another port, call its `/__dev/scheduled-send` endpoint with the existing local worker authorization instead.

The existing local provider isolation rules still apply. Real Gmail mutation tests require a dedicated test mailbox and explicit watch ownership. Local managed mail does not silently send through production resources. Use the focused service tests and worker alarm tests for deterministic dispatch and recovery checks.

Undo Send uses the same local timer, signed callback and repair scan. If the worker is unavailable, a message remains held or pending until the worker recovers. The composer does not claim it was sent. Run `vp test packages/orpc/tests/held-send-concurrency.test.ts` for real SQL deadline and lease races against an automatically removed loopback Docker fixture. These fixtures replace provider boundaries and send no external mail.

## Rollout

Apply the additive scheduled-send database migration through the protected workflow first. Deploy the web code with the authenticated dispatch route second. Deploy the updates worker with its new `ScheduledSend` binding and appended Durable Object migration third. This order gives new alarms a reachable handler and an existing database table. Existing releases remain compatible with the added table.

Deploy the maintenance worker with its bounded repair scan. Preserve the existing Durable Object migration history and the permanent send receipts when rolling forward or back. Retained scheduled payloads remain referenced until delivery or successful draft restoration, so the regular object cleanup cannot discard future attachments.

Production migration and deployment require explicit authorization. Implementing this feature does not apply either operation.

The additive `deliveryKind` migration must precede Undo Send code. Existing rows default to scheduled delivery and keep the existing timer contract. During a rolling release, source reservations and operation identities cover both kinds. Keep the lifecycle code deployed until held operations finish before rolling back to code that cannot distinguish ordinary holds.
