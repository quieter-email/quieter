# Mail importance

Important is a mailbox category backed by incoming message classifications. It uses the ordinary thread list, search, reader, and mail actions. Archived messages can qualify. Spam, trash, drafts, and deleted messages do not qualify for the Important view.

A thread qualifies when at least one eligible incoming member is important. The thread indicator uses that aggregate even when the displayed list anchor is a different message. Quieter importance does not read or change Gmail's native importance labels.

## Classification and manual decisions

Incoming source capture creates durable importance work. The background processor runs without an open mailbox or enabled auto-label rules. It reads captured message content and deterministic analysis, then asks the configured background model for a boolean decision. Existing retained sources can enter bounded recovery processing. Gmail history outside captured content is not imported for classification.

Each message has separate automatic and manual decisions. The effective value is `manualImportant ?? aiImportant ?? false`. An explicit negative decision persists as an override. Marking a thread changes its current incoming members. Later arrivals receive their own classification.

Classification work belongs to one mailbox and message. A content fingerprint prevents label or read changes from causing another paid classification. Workers claim work with expiring leases and publish results only while the lease and content fingerprint still match. Automatic completion never writes the manual decision.

Failed or budget-paused work remains eligible for later processing. Each paid model attempt has a separate usage record, including attempts with invalid output. Usage reporting can retry without repeating a completed model invocation.

## Mailbox policy and access

Importance policy is mailbox-wide for private and shared mailboxes. Context loads through `loadAiAgentContext` with mailbox memory. Private mailboxes also use their owner's personal memory. Shared mailboxes exclude personal memory. Billing ownership does not grant access to mailbox content or personal context.

Gmail owners and managed-mail responders or managers can change importance. Readers retain read access without permission to change the shared decision. Explicit marks create mailbox-scoped learning events. A learning failure cannot undo a committed manual decision.

Message content and memory are untrusted classification input. The model receives no tools or permission to change provider state. Private mail and mailbox identifiers must stay out of product analytics and routine logs.

## Local operation

Use the existing development setup in [Development](development.md). Keep development model credentials separate and budget-limited. Local model processing requires the existing explicit opt-in and billing controls.

```bash
vp run env:doctor
vp run dev:full
# In another terminal:
vp run dev:fixtures your-local-login@example.com
vp run dev:trigger importance
```

`POST /__dev/importance` drains a bounded batch through the request-scoped database client. The endpoint is available only in local mode, rejects browser origins, and requires the local Worker token. Repeat the trigger to drain more pending work. Local maintenance remains manual.

Verify that an incoming source creates work before opening the UI. After processing, check Important membership and the thread indicator. Mark a message as not important, reload, and confirm that a later worker result preserves that decision. Repeat with a positive override. Use separate mailboxes and access roles to check isolation. Real Gmail tests need the development Pub/Sub subscription and the watch ownership rules in [Development](development.md).

## Daily Brief retirement

The current application removes Daily Brief routes, jobs, schedules, and fixtures. The additive migration retains its legacy tables and schema types for compatibility with a previously deployed release. A later contract migration can drop those tables after old handlers stop. Historical learned memory remains intact.
