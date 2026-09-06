# Reliability findings

These findings describe the audited commit, not fixes made by this audit. P1 means prioritize before extending the affected feature. P2 means schedule a bounded correction. "Reproduced" means a local, isolated reproduction; "traced" means the failure follows from the inspected control flow without exercising production.

## F01

### P1: Mail usage locking deadlocks the local pool and relies on unsupported Hyperdrive behavior

Evidence: [packages/billing/src/organization-mail-usage.ts:75](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/organization-mail-usage.ts#L75), [packages/database/src/client.ts:61](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L61), [packages/orpc/src/organization-mail.ts:249](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L249).

The send wrapper reserves a database connection and acquires a session advisory lock. Its callback then queries through the ordinary database client, rather than the reserved connection. Local configuration has a maximum of one connection. That connection is occupied by the lock, and the callback cannot obtain another to proceed. With larger pools, sends also hold connections while making provider requests. If unlocking throws, the subsequent release is skipped.

Cloudflare explicitly lists advisory locks as unsupported by Hyperdrive. The problem also reaches transaction advisory locks in billing credits and delivery handling, wherever those execute through Hyperdrive. This is a documented compatibility conflict, not a claim that a production outage was observed. [Hyperdrive feature support](https://developers.cloudflare.com/hyperdrive/reference/supported-databases-and-features/).

Use a short transaction to reserve quota with row locking or an atomic update. Pass the transaction client explicitly and release it before network I/O. Make cleanup unconditional. Check the other advisory-lock callers at [packages/billing/src/credits.ts:137](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/credits.ts#L137) and [packages/orpc/src/organization-mail-delivery.ts:376](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail-delivery.ts#L376).

Validation worth keeping: two competing sends at the spending limit, plus a send with the configured one-connection local pool.

## F02

### P1: A failed API send strands its idempotency key

Evidence: [packages/orpc/src/organization-mail.ts:109](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L109), [packages/orpc/src/organization-mail.ts:155](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L155), [packages/orpc/src/organization-mail.ts:327](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L327).

The API writes a pending record before calling the provider. Every later request with that key receives an in-progress conflict until a completed result exists. A provider rejection or interrupted request has no transition out of pending. Cleanup uses the seven-day retention period, rather than a recoverable operation state.

A temporary send failure can therefore make the documented safe retry mechanism unusable. Switching keys risks a duplicate if the original outcome was uncertain.

Persist distinct rejected, accepted, and unknown outcomes. Permit a retry after a definite rejection. Reconcile an unknown outcome before resending. Do not solve this by deleting pending records after an arbitrary short timeout.

Validation: definite provider rejection followed by retry, and provider acceptance followed by loss of the response. The latter must never silently resend.

## F03

### P1: Provider acceptance and local send records have no reliable completion path

Evidence: [packages/orpc/src/organization-mail.ts:220](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L220), [packages/orpc/src/organization-mail.ts:357](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/organization-mail.ts#L357), [packages/orpc/src/managed-mail/messages/service.ts:1742](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L1742).

After a successful provider send, the API records the API message, sent-folder entry, usage, and idempotent response through separate operations. Some errors are swallowed; the sent-folder write can reject the surrounding Promise.all. The composer also swallows persistence errors and returns a provider ID as the internal message ID when saving fails.

Consequences include delivered mail missing from Sent, incomplete usage accounting, delivery events without the expected local record, and a send reported as failed after the provider already accepted it. Reporting an exception does not repair those states.

Create a durable send operation before sending. Store acceptance and its provider reference, then complete local projections and usage through retryable work. Expose uncertain delivery explicitly. Both API and composer should use the same service for this lifecycle.

Validation: fail each persistence boundary after provider acceptance. Retrying recovery must restore the local record and accounting without sending again.

## F04

### P1: Managed drafts and sent messages store attachment metadata without the bytes needed to reopen them

Evidence: [packages/orpc/src/managed-mail/messages/service.ts:737](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L737), [packages/orpc/src/managed-mail/messages/service.ts:1373](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L1373), [packages/orpc/src/managed-mail/messages/attachments.ts:41](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/attachments.ts#L41), [packages/orpc/src/managed-mail/messages/raw-object.ts:86](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/raw-object.ts#L86).

Managed draft persistence saves attachment names, sizes, and types. Outbound persistence does the same and explicitly stores null legacy raw-object references; it supplies no canonical raw-object reference either. The attachment reader always retrieves the original raw message and extracts the matching part. Without that object it throws before extraction.

This is a normal product path, not an obscure malformed-message case. A managed attachment can be sent successfully yet be unavailable from Sent. A saved draft cannot recover its uploaded bytes through the server attachment reader after the client runtime files are gone. Inline images share the persistence gap.

Store the original MIME message or durable attachment objects as part of draft/send persistence. Keep one owner-scoped attachment reference model and reuse existing raw-object storage. Define replacement and orphan cleanup alongside the write.

Validation: save a draft containing a file and inline image, reload, reopen, send, and download the same bytes from Sent.

## F05

### P1: Composer sends bypass atomic spending enforcement and have no stable send identity

Evidence: [packages/orpc/src/managed-mail/messages/service.ts:1630](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L1630), [packages/orpc/src/managed-mail/messages/service.ts:1670](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L1670), [packages/orpc/src/managed-mail/messages/service.ts:1704](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L1704).

Managed composer sends check allowance, perform the external send, then record usage. Concurrent requests can all pass against the same remaining balance. Unlike the API path, this path has neither a quota lock nor a persisted idempotency claim. Each request creates a fresh message header ID, even though the draft already carries a stable local ID.

The disabled Send button prevents one UI gesture from repeating. It does not protect against two tabs, a retried request, or a lost response.

Unify API and composer sending around a durable operation ID and atomic quota reservation. Scope that identity to the mailbox and authenticated actor. A draft ID alone needs revision handling so an edited draft is not confused with a previous send.

Validation: simultaneous sends near the cap and a repeated request after acceptance.

## F06

### P1: Inbound processing deletes its retry input before usage recording is complete

Evidence: [packages/aws/src/receipt.ts:195](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/src/receipt.ts#L195), [packages/aws/src/receipt.ts:251](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/src/receipt.ts#L251), [packages/orpc/src/managed-mail/messages/ingestion.ts:220](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/ingestion.ts#L220).

The receipt handler ingests the message, removes the unreferenced S3 object, then records inbound usage. With canonical storage in R2, a usage failure causes a retry that starts by requesting the now-deleted S3 object. With canonical S3 storage, duplicate ingestion returns no newly inserted mailbox IDs, so the conditional billing step is skipped.

The usage write is designed to deduplicate, but the retry control flow prevents it from running in both cases. This can lose accounting permanently.

Persist receipt progress and required usage work before acknowledging or deleting input. Base accounting on the receipt identity, not whether this delivery inserted a new mailbox row. Delete intake storage only after all required durable work exists.

Validation: fail usage once after successful ingestion, retry the same receipt, and verify one message plus exactly one usage event for both storage providers.

## F07

### P1: A transient post-ingestion failure permanently skips later automation

Evidence: [packages/orpc/src/managed-mail/messages/ingestion.ts:77](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/ingestion.ts#L77), [packages/orpc/src/managed-mail/messages/ingestion.ts:233](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/ingestion.ts#L233).

Thread-label inheritance, rules, AI automation, and action enqueueing run sequentially inside one catch-and-report block. A failure in an early step prevents the later steps from running, but ingestion still succeeds. The duplicate-message path retries labels and rules only. It does not rerun AI processing or action enqueueing.

A temporary labeling failure can therefore mean an incoming message never triggers its configured action. Neither queue retries nor error reporting repair the missing enqueue.

Write a post-ingestion job alongside the message, then execute its idempotent stages independently. Existing queues can carry this work; another orchestration framework is not required for this small pipeline.

Validation: fail the first stage once and verify the action is eventually enqueued once.

## F08

### P1: Action retries can duplicate external writes or replay the wrong result

Evidence: [packages/orpc/src/mailbox-actions/executor.ts:195](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L195), [packages/orpc/src/mailbox-actions/executor.ts:216](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L216).

External-effect deduplication reads an effect row, performs the remote write, and inserts the row afterward. A crash between those last two steps leaves the write repeatable. Successful writes without an external ID are not recorded at all.

The key is run ID, node ID, and call index. The model runs again on retry and may generate a different operation at the same position. The stored record contains no argument identity check before its result is reused. Multiple visits to the same node also share that positional namespace.

Persist an immutable planned operation with its input hash before execution. Use provider idempotency when available; otherwise retain an unknown state for reconciliation. Include the actual node invocation or branch identity. Persist successful outcomes even when the provider does not return an object ID.

Validation: crash after provider acceptance, change the next generated tool call on retry, and execute the same node from two incoming branches.

## F09

### P1: Action leases expire without renewal or protection against stale executors

Evidence: [packages/orpc/src/mailbox-actions/executor.ts:78](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L78), [packages/orpc/src/mailbox-actions/executor.ts:476](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L476), [packages/orpc/src/mailbox-actions/executor.ts:769](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L769).

A run receives a ten-minute lease once. There is no renewal during execution. The executor permits up to 500 node executions; connector steps may each use 45 seconds, and the whole run has no deadline guaranteeing completion within the lease.

Another worker can reclaim an expired running job while the first still executes. Final updates match the run ID without a lease token, so the old worker can overwrite the replacement worker's state. This amplifies F08.

Use a lease generation/token checked by every state transition, renew while processing, and stop when ownership is lost. Set an overall execution budget consistent with the runtime. Alternatively, delegate durable step scheduling to the platform as discussed in F39.

Validation: expire a lease while the first executor is paused, claim with a second executor, then resume the first. It must not issue more writes or finish the new owner's run.

## F10

### P1: Chat approvals are consumed after tool execution, allowing concurrent replay

Evidence: [packages/orpc/src/chat/service.ts:906](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/chat/service.ts#L906), [packages/orpc/src/chat/service.ts:961](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/chat/service.ts#L961), [packages/orpc/src/chat/service.ts:1126](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/chat/service.ts#L1126).

A continuation reads the pending assistant message and applies approval decisions in memory. Mutating tools then execute. The compare-and-swap against the original message parts happens only when saving the finished assistant turn.

Two requests approving the same tool call can both execute it before either saves. The later conflict protects the transcript, not the external action. If generation fails after a tool succeeds, the early return also leaves the original pending approval unchanged.

Atomically claim the approval before executing tools and persist each tool result independently of whether the model finishes its prose. Reuse stable operation IDs for externally visible actions.

Validation: two concurrent approvals produce one external write; a model failure after a successful tool call does not make that tool repeatable.

## F11

### P1: Mailbox actions spend AI usage without checking the current entitlement or budget

Evidence: [packages/orpc/src/mailbox-actions/service.ts:220](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/service.ts#L220), [packages/orpc/src/mailbox-actions/executor.ts:573](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L573), [packages/orpc/src/mail-automation/ai-budget.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mail-automation/ai-budget.ts#L1).

The action execution path loads an owner for usage reporting and calls the model. It does not perform the entitlement and budget checks used elsewhere for AI work. Creation and enqueueing do not supply that missing execution-time protection.

An enabled action can continue generating cost after the relevant allowance or subscription changes. Receiving mail is deliberately retained after some subscription changes, so relying on ingress to stop these runs is insufficient.

Check the current billing actor, entitlement, and available budget when claiming work, then reserve a bounded allowance for the run. Reuse the existing billing and automation budget contracts. A permission check at action publication alone will become stale.

Validation: a queued action whose allowance is exhausted or entitlement is removed must not call the model.

## F12

### P1: Closing a composer discards recovery state even when draft saving fails

Evidence: [apps/web/src/features/compose/components/use-compose-dialog-controller.ts:434](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/use-compose-dialog-controller.ts#L434), [apps/web/src/features/compose/components/use-compose-dialog-controller.ts:460](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/use-compose-dialog-controller.ts#L460).

Close immediately hides the dialog and invokes its close callback, then schedules the save. Its finally block removes the saved-draft reference and clears runtime files on both success and failure. Closing through navigation can unmount the controller as well. The error toast tells the user to retry without preserving a recovery flow or the attached files.

Keep a mailbox-scoped draft store alive until persistence succeeds or the user explicitly discards. A failed close-save should reopen or expose a recoverable draft with its files. Save before a full page exit; an unmount callback alone cannot make an asynchronous network write reliable.

Validation: type text, attach a file, force a save failure, and close. The exact text and file must remain recoverable.

## F13

### P1: A temporary domain verification failure can stop accepting already-routed mail

Evidence: [packages/orpc/src/mail-domain/verification.ts:54](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mail-domain/verification.ts#L54), [packages/orpc/src/mail-domain/verification.ts:111](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mail-domain/verification.ts#L111), [packages/orpc/src/managed-mail/messages/ingestion.ts:285](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/ingestion.ts#L285).

The verification action catches a failed provider identity lookup and substitutes an empty identity. It recomputes and persists domain status from that failed check and clears verifiedAt. Inbound destination selection requires a verified domain. Existing receipt routing can still deliver messages after a temporary verification API or DNS failure, while ingestion no longer recognizes the domain as eligible.

Separate unavailable verification from a definitive invalid configuration. Preserve the last confirmed state when a check cannot be completed, record the failed check, and surface it to the user. Definitive ownership or routing failures need an explicit state transition rather than the same empty-result fallback.

Validation: recheck a verified receiving domain while the identity API times out, then ingest an already-routed message.

## F14

### P2: A wait-all merge node never waits or merges

Evidence: [packages/orpc/src/mailbox-actions/graph.ts:26](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/graph.ts#L26), [packages/orpc/src/mailbox-actions/executor.ts:386](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L386), [packages/orpc/src/mailbox-actions/executor.ts:736](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L736).

The schema offers wait_all as the default merge mode. Execution immediately emits the out port for each incoming frame. It neither waits for the other branches nor joins their variables and outputs. Downstream nodes can execute once per arrival with incomplete branch context.

Either implement actual join semantics with invocation identity or reject this mode until supported. Removing an unsupported choice is much smaller and safer than quietly treating it as pass-through.

Validation: a two-branch graph converges and executes the downstream step exactly once with both branch outputs.

## F15

### P2: Compose handoff is global mutable state consumed during render

Evidence: [apps/web/src/features/compose/domain/compose-session.ts:5](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/domain/compose-session.ts#L5), [apps/web/src/features/compose/components/compose-workspace.tsx:671](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-workspace.tsx#L671).

The pending session contains a draft and return category but no mailbox ID. A module-level variable carries it between views. A useState initializer takes and clears that variable, which makes rendering destructive. A discarded or repeated initialization can consume the handoff without committing the view. The draft can also be taken under a different mailbox context because the handoff has no ownership assertion.

This is a state-design footgun, not a demonstrated cross-mailbox data disclosure.

Use the existing client state approach for a session keyed by mailbox ID and compose ID. Reading should be pure; consume the handoff after the receiving session commits. Keep navigation and recovery state explicit.

Validation: switching mailboxes during a compose handoff and mounting under development strict rendering must preserve the draft and sender identity.

## F16

### P2: Two handwritten MIME writers produce invalid or changed messages

Evidence: [packages/mail/src/send.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/send.ts#L1), [packages/mail/src/compose/mime.ts:96](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/mime.ts#L96).

Four local reproductions confirmed concrete defects:

- A 110-character unbroken ASCII subject becomes 111 characters after parsing because hard folding inserts whitespace.
- A subject consisting of 35 ASCII characters followed by é and text splits the multibyte character across encoded words. Fatal UTF-8 decoding of the first word fails. The installed postal-mime parser tolerates it, so visible corruption was not reproduced for that case.
- A sender such as Jörg <sender@example.com> is encoded as one encoded word, including the address syntax.
- Composer quoted-printable output contains a physical line of 1,200 characters for a 1,200-character ASCII body.

These are transport rules, not product-specific behavior. RFC 2047 requires complete characters within encoded words and restricts where encoded words can appear. Quoted-printable has a 76-character line limit. [RFC 2047](https://www.rfc-editor.org/rfc/rfc2047.html), [RFC 2045](https://datatracker.ietf.org/doc/html/rfc2045).

Replace the duplicate encoders with one maintained MIME composer after verifying Worker compatibility, or use structured provider sending where it supports the required message. Keep Quieter-specific draft headers in a thin adapter.

Validation: round-trip observable subject, addresses, body, and attachments through an independent parser. Include standards constraints the parser deliberately tolerates.

## F17

### P2: Structural compose headers accept newline injection

Evidence: [packages/mail/src/compose/schema.ts:281](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/schema.ts#L281), [packages/mail/src/compose/mime.ts:153](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/mime.ts#L153), [packages/mail/src/compose/mime.ts:220](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/compose/mime.ts#L220).

The draft schema accepts arbitrary strings in draft anchors and reply context. MIME construction interpolates them into headers. A local reproduction passed sourceMessageId containing id followed by CRLF and X-Audit-Injected: yes. Schema validation accepted it and the generated raw message contained the additional header.

Apply CR/LF rejection to every structural header input and validate message IDs and references as structured values. Preserve the restrictions on custom header names. Fixing only the visible Subject field would leave this path intact.

This demonstrates header injection by an authenticated compose input; it does not establish an authorization bypass or unauthenticated sending.

Validation: one boundary test verifies all externally supplied structural header fields reject line breaks.

## F18

### P2: The custom calendar parser reads nested alarm properties as event properties

Evidence: [packages/orpc/src/connectors/ical.ts:66](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/ical.ts#L66), [packages/orpc/src/connectors/ical.ts:85](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/ical.ts#L85).

The parser collects every line inside the first VEVENT without tracking nested component scope. A local fixture with a VALARM DESCRIPTION before the event DESCRIPTION produces Alarm text as the event description instead of Meeting text.

The same parser also manually splits parameters and constructs date values. Extending this implementation to calendar syntax and timezone semantics is a poor use of product code.

Use a maintained iCalendar parser behind the existing calendar draft contract. Explicitly support a documented subset when mapping into the target calendar, rather than guessing unsupported date semantics.

Validation: a representative exported invitation with an alarm, recurrence, and timezone. Assert the event shown to the user, not parser internals.

## F19

### P2: The site-password return URL helper accepts an external redirect

Evidence: [apps/web/src/start.ts:541](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/start.ts#L541), [apps/web/src/lib/return-to.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/return-to.ts#L1).

This helper rejects double forward slashes but permits a slash followed by a backslash. URL parsing normalizes that combination into an authority delimiter for HTTP URLs. A returnTo value formed from "/" + "\\" + "example.org" passes the guard and resolves outside the site.

The repository already has a stronger auth return-URL helper that rejects backslashes and checks origin. Consolidate around that behavior instead of maintaining a second weaker version. This finding concerns the site-password redirect path, not the OAuth callback's protection.

Validation: assert same-origin resolution for a small table of ordinary paths, double slashes, backslashes, and absolute URLs.

## F20

### P2: The migration safety gate accepts destructive PostgreSQL syntax

Evidence: [packages/database/scripts/migration-safety.ts:28](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/scripts/migration-safety.ts#L28).

The gate recognizes DROP COLUMN but not PostgreSQL's legal form without the optional COLUMN keyword. A local call accepted ALTER TABLE "mailbox" DROP "displayName". It also accepted renaming a table, which can break a running release even though it preserves rows. [PostgreSQL ALTER TABLE syntax](https://www.postgresql.org/docs/current/sql-altertable.html).

The gate's error text promises that deploys only allow expand-safe migrations. A small regex denylist cannot provide that guarantee.

Keep the immutable historical migration hashes. For new migrations, use a PostgreSQL-aware statement classifier plus a deliberately conservative allowlist, and retain a protected review path for operations that need an expand/contract decision. Do not try to enumerate every destructive spelling with more regexes.

Validation: classify actual statements and preserve historical hashes. This is an appropriate place for focused safety tests.

## F21

### P2: CI and deployment silently skip the intended SDK build

Evidence: [.github/workflows/ci-main.yml:95](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/ci-main.yml#L95), [.github/workflows/sst-deploy.yml:84](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/sst-deploy.yml#L84), [packages/sdk/package.json:2](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/package.json#L2).

Both workflows execute vp run @quieter/sdk#build. The package is actually named quieter. Running the workflow command locally exited successfully with no task output and no SDK build. Running vp run quieter#build executed the expected pack step and produced the JavaScript and type declarations.

Change the selector to the real package name, and make this gate verify the expected artifacts so a future rename cannot silently remove it. The confirmed defect is a no-op build gate, not a demonstrated production runtime failure.

Validation: invoke the exact workflow command in a clean checkout and check that the distributable is produced.
