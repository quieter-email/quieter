# Mailbox assistant authority

Mailbox owners and managed mailbox managers control assistant read-only mode and automation pause through the existing mailbox settings. These controls preserve each feature's opt-in and the actor's ordinary mailbox, calendar and connected-account permissions.

Read-only mode blocks assistant domain writes, including saving drafts and changing personal memory or reminders. Search, reading and unsaved proposals remain available. Automation pause blocks new automatic execution and effects. Fresh interactive requests remain available when read-only mode permits them. Human controls use their ordinary permissions.

The server captures an explicit human origin or an AI origin with its actor, mailbox, mode and original policy version. Public inputs cannot supply that authority. Every actual policy change advances the version. A retry keeps its original admission, so toggling permissions back does not revive older work. Native Actions also retain their own admission epoch, leases, receipts and usage.

Server callers can import the reusable contract from `@quieter/orpc/ai-authority`. Capture authority before preparing an operation. Finish credential refresh, remote permission reads and request preparation before the final database decision. Calendar and connector guards use a short transaction to check current policy, actor access, exchange or run, private context and exact target grants, then commit before provider dispatch. Native mail operations use the same current checks through their own transaction executor and retain their existing send and placement serialization. Revocation after final admission cannot recall an already dispatched operation.

Personal memory and connected personal context remain private even when their display metadata has no source mailbox. Trusted chat provenance and cached classifier provenance retain that fact across continuations and retries. Assistant persistence into a shared mailbox is denied when protected context was used. A fresh shared-mailbox request using public context can still save a draft. Explicit human adoption remains an ordinary human action.

Held and scheduled sends bind the captured content, actor, mailbox, permanent send operation, origin and privacy. Cancellation stores its own authority packet atomically with the canceled state. Background draft restoration uses that original packet. An explicit fresh human recovery can restore a draft under current permissions. Accepted and uncertain delivery receipts remain authoritative when later incidental assistant learning or reminder work is denied; recovery never resends an accepted message.

Legacy pending AI work without provable authority fails closed. Completed results and receipts remain readable. Intrinsic capture, bookkeeping, cleanup and deterministic non-AI work retain their existing owners. No permission change deletes private memory, reminders, receipts or accounting.
