# Mail receive execution

`packages/orpc/src/mail-receive.ts` defines the internal receive stage contract. Its type map binds each stage to its identity and allowed outcomes. `runReceiveStage` passes that identity to the adapter and records safe timing and status diagnostics. Existing owners retain authorization, loading, leases, checkpoints, effects, retries, and final writes.

## Stages and owners

| Stage | Identity | Outcome and durable owner |
| --- | --- | --- |
| `verification_code` | Mailbox and canonical message | The existing verification processor returns complete or its native retry deadline. Managed mail without an owner is skipped. `mailboxVerificationCode` owns extraction and usage checkpoints. |
| `auto_label` | Mailbox and canonical message | The per-message processor returns complete or its saved retry deadline. Disabled settings, missing ownership, and missing entitlement are skipped. `gmailAutoLabelEvent` and the existing label adapters own classification and application. |
| `managed_rules` | Mailbox and persisted managed message | A null native error projects complete. A non-null error projects needs attention and retains the host's existing failure propagation. Existing rule runs and send receipts own progress and effects. |
| `personal_actions` | Mailbox and canonical message | Handed off means new eligible runs committed through the existing inbox transaction. Zero admissions are skipped. This does not mean the Action executed. |
| `personal_action` | Mailbox, canonical message, actor, and existing run | The whole Action execution returns complete, skipped, admission retry, needs attention, or lost ownership. `mailboxAgentRun` and `mailboxAgentEffect` remain authoritative. |

Gmail uses its existing provider message ID. Managed mail uses its persisted message ID and original arrival time on redelivery. Neither path changes source keys, invocation keys, activation checks, or actor/message uniqueness. Manual Actions execute outside incoming-message identity.

Action completion, eligibility skips, admission retries, and terminal failures confirm the existing lease-token-fenced update with `RETURNING`. Zero matching rows mean lost ownership. The drain result includes numeric outcome counts, also available through the existing local Action worker endpoint.

Managed auto-label processing respects an existing future retry deadline on duplicate arrival. Budget-deferred work can resume early when its existing budget owner allows it. Admission contention and ordinary failures retain the saved deadline. The existing defer owner returns the deadline it saved rather than a consumer calculating another one. Arriving-message outcomes remain separate from concurrent backlog work.

## Publication and failure

Gmail retains its shared lazy content promise and critical `Promise.allSettled` composition. Code extraction and labels finish before the existing critical callback. Capture, context, Action admission, and reminders remain follow-ups.

Managed ingestion awaits durable Action admission before starting publication alongside memory, reminders, and post-processing. Post-processing still inherits thread labels, applies rules, then settles verification, importance, and labels concurrently. An unavailable admission database can still delay initial managed publication.

The optional abort signal checks only before invocation. An abort after invocation cannot relabel a confirmed or uncertain effect as safely cancelled. Diagnostic observers are synchronous, receive only stage, status, and elapsed time, and cannot change the processing result by throwing. Private identity, content, provider errors, and URLs never enter those diagnostics. Existing owners still report unexpected failures.

## Effect safety and limits

Action effect receipts remain pending before dispatch, completed after confirmation, or uncertain after an unconfirmed write. Existing reclamation refuses automatic replay when an effect already exists. Managed rule forwarding preserves `rule:<run.id>:<action ordinal>` and the existing organization send receipt. Personal Action send and unsubscribe capabilities remain unavailable.

This contract adds no queue, durable history, cancellation state, content loader, scheduler, classifier, or capability. QUIETER-119 history and the full QUIETER-120 migration remain separate work. QUIETER-204 policy changes require their approved implementation at the existing authority owners. Source checks and stubbed-provider tests do not prove real-provider behavior or production policy readiness.
