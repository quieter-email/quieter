# Mail Snooze

Snooze hides incoming mail until a stored return time. The deadline and exact hidden message IDs survive browser and process restarts. A new incoming reply ends the schedule and brings the conversation back to Inbox while older handled history stays unchanged.

Snooze is mailbox state. Managers and responders can change it in shared managed inboxes; readers can view it. Gmail remains private to its owner. Personal reminders retain their separate actor scope and clocks.

## Commands

`mail.applySnooze` accepts one source mailbox, a fresh UUID request identity, a command and versioned conversation targets. All inboxes translates display identities to source identities before grouping by mailbox. Each target carries the current source version, or `null` when no schedule exists. Initial Snooze also needs nonempty canonical message anchors.

| Command | Effect |
| --- | --- |
| `snooze` | Freeze eligible Inbox messages and known incoming IDs before hiding mail. |
| `reschedule` | Change the deadline and named time zone while retaining the hidden set. |
| `cancel` | Stop the return without changing native placement. Recovery controls say **Cancel return** when hiding was not confirmed. |
| `return-now` | Restore only the saved hidden set, subject to current grants, source eligibility and newer intents. |

The server validates future deadlines and named time zones. The editor rejects missing or repeated local times around clock changes. Bulk responses retain per-target success or failure. The UI refreshes authoritative state after results, errors and replays instead of projecting a label change.

An accepted identity binds the actor, mailbox and complete normalized batch. Changing its payload conflicts. Replay requires current authorization and does not admit new targets or dispatch another native effect. Fresh commands and expanded history use the existing weighted placement budget and source-work limits.

## Durable state and recovery

`mailSnooze` holds the current lifecycle version, deadline, actor, exact hidden IDs, known incoming IDs, native phase references, execution lease and next wake. `mailSnoozeOperation` retains the accepted command identity and outcome. Native hide and return use stable placement request identities stored before their effects.

A lifecycle version and an execution lease serve different purposes. Every effect and failure transition checks its accepted version and execution ownership. Temporary lease tokens are excluded from immutable native request hashes. Replacing a worker therefore does not create another command identity.

Native writes already recorded as pending, submitting or uncertain are never automatically resent. Fresh source inspection can confirm the exact saved goal without another write. Confirmation commits the native receipt, schedule and matching command outcome together. This prevents a delayed API response from overwriting confirmed success.

`preparing`, `active` and `returning` describe normal progress. `suspended`, `failed` and `uncertain` retain recovery evidence. Lost grants, reconnect-required credentials, a missing actor or a missing hide predecessor pause automatic return. An authorized writer can explicitly recover or adopt the schedule. `returned`, `cancelled` and `superseded` end its automatic lifecycle.

Canonical inbound observers run after persistence, independently of AI credits and reminder evaluation. Known incoming IDs make old capture replays harmless. Read repair requires an unknown Inbox incoming ID and the observed schedule version; an old pre-hide projection cannot retire a newer hide. Due processing also inspects fresh source to repair missed observations.

Deleting a mailbox cascades to its schedules. Explicit Gmail disconnect removes its mailbox row, so it cannot promise a future return. Temporary credential failure preserves the schedule and its exact hidden set. Accepted journal identities have no lifetime storage bound; retained growth remains an operational uncertainty.

## Views

Later contains current schedules and recoverable failures, hydrated through the complete canonical mail projection. Rows retain sender details, attachments, thread counts, importance, unsubscribe state and source mailbox identity. Done excludes schedules that still own the latest placement. Unrestricted search retains its native acquisition path.

Read and importance changes do not infer new Later or Done membership from a schedule status. Existing members receive metadata updates; authoritative queries determine derived membership. Shared Snooze visibility does not expose another member's personal reminders.

## Runtime

`MailSnooze` is an isolated Durable Object with immutable `{id, mailboxId}` scope. It stores a recovery alarm before dispatch and fences callback results with a wake token. Its signed callback carries no actor; the backend loads the current actor and authorization from durable state. The clock imports neither a database client nor a mail provider.

`/mail/snooze/wake` and `/api/internal/mail-snooze` use separate ticket purposes and the existing linked live-sync signing secret. Tickets cover the exact bounded request body and expire shortly after issuance. The callback's site-password exception does not bypass ticket authentication or the request database scope.

The updates Worker owns the namespace. The legacy realtime gateway points to that owner; local and test Workers have their own bindings. Existing maintenance reconciles a bounded set of missed wakes. No additional cron or signing secret is required.

## Verification interfaces

The PostgreSQL fixtures require loopback databases named `mail_snooze_fixture`, `mail_snooze_queries_fixture` and `placement_fixture`. Their environment variables are `QUIETER_TEST_SNOOZE_DATABASE_URL`, `QUIETER_TEST_SNOOZE_QUERY_DATABASE_URL` and `QUIETER_TEST_PLACEMENT_DATABASE_URL`. These fixtures create and reset only their disposable tables.

`packages/cloudflare/tests/mail-snooze.test.ts` uses the actual registered Worker pool, alarm execution, eviction and durable storage helpers. Synthetic callback transports isolate provider effects. Browser previews verify mounted controls and persisted demo state; they do not establish native automatic return. Live Gmail behavior requires an exclusive test mailbox and watch ownership.

Local startup, secret bindings and authenticated triggers are documented in [Development](development.md#running).
