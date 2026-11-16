# Mailbox AI authority storage

QUIETER-204 uses a mailbox-owned policy record to distinguish interactive AI read-only mode from automation pause. This PR prepares the shared storage contract. G owns authorization, UI, policy changes and execution fencing in the dependent feature.

The record starts with both controls disabled and version zero. Every policy change must increment its version in the application service. An absent record preserves existing behavior and does not activate any feature. This table alone does not enforce authority.

The policy belongs to the mailbox. Removing the last editing user clears only the audit reference. Deleting the mailbox removes the policy. Apply the additive migration through the protected workflow before releasing consumers. No shared development or production migration was applied.

## Verification

Migration drift and safety checks, full-chain creation and replay, scoped lint/type checking, and all 1,360 existing tests pass. Independent Sol review found no actionable issues.

A transaction on disposable loopback PostgreSQL verifies default state, rejects a negative version, preserves paused/read-only policy when its editing user is deleted, and cascades policy deletion with its mailbox. The transaction rolls back after verification. Runtime authorization and in-flight effect fencing remain unverified by this storage PR.

This schema unit stacks on PR #533 to preserve one migration/snapshot chain. That ordering is a shared migration integration constraint, not a product prerequisite on Undo Send.
