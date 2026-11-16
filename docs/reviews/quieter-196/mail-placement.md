# Mail placement storage expansion

QUIETER-197 needs mailbox-visible Done state and a durable record of each actor's per-thread placement intent. A owns the canonical commands, provider adapters, UI, retries and explicit uncertain outcomes. This PR prepares their shared schema contract.

`mailPlacementOperation` stores the requested and frozen message sets, request hash, actor, mailbox, thread, ordered identity and outcome. Its actor/mailbox/request/thread key rejects duplicate reservations. Placement and status checks constrain stored values. Actor or mailbox deletion cascades to its records.

Managed message placement now admits `done`. The existing automation message adapter removes Inbox while retaining Unread for unread done messages. It cannot emit undefined labels after the selected state type expands.

## Release and rollback

Apply the migration through the protected workflow before A's compatible runtime emits done rows. Its existing-table check replacement requires explicit contract review and validates the table under an ALTER TABLE lock. No production lock duration was measured. No shared development or production migration was applied.

Older readers do not fully understand done rows. After the new writer is enabled, rollback requires compatible readers or an explicitly reviewed conversion procedure. Schema preparation alone does not establish runtime compatibility, permission checks, state transitions, at-most-once effects or conditional Gmail writes. Do not enable a new writer from this storage PR alone.

This unit stacks on #536 and #533 to preserve one generated migration/snapshot chain. The order is shared schema integration, not a product dependency on AI policy or Undo Send.

## Verification

Migration drift/safety, full-chain creation/replay, scoped lint/types and all 1,360 existing tests pass. Independent Sol review found the missing done label-map case, which is corrected in the same unit.

A disposable PostgreSQL transaction verified distinct operation sequences, duplicate request rejection, invalid placement/status rejection, submitting/uncertain states and actor/mailbox cascades. The transaction rolled back afterward. A must verify the full command and canonical row contracts before its dependent feature is review-ready.
