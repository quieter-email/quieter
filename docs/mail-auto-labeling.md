# Automatic labeling

The Labels workspace has separate label management and auto-labeling tabs. The auto-label library contains editable presets with illustrative emails. A preset can create a new label or configure an existing label. Saving a preset does not turn on mailbox automation; the mailbox switch controls that separately.

## Matching

Both mailbox providers store the same nullable `autoLabel` settings on each label. The contract and deterministic matcher live in `@quieter/mail/auto-label`.

- A null configuration preserves existing AI classification using the label name, description, and legacy inclusion criteria.
- A configuration with `enabled: false` excludes that label from automation.
- Sender conditions match an exact parsed email address. Display names cannot satisfy them.
- A domain such as `example.com` matches only that domain. `*.example.com` matches one or more subdomain levels, excluding the main domain. Add both patterns to include both.
- Keywords are case-insensitive literal substrings or phrases. They can match the subject, body, or either.
- Entries within a field are alternatives. Match all or Match any combines the nonempty sender, domain, and keyword fields.
- A nonempty AI prompt adds an AI confirmation after those conditions match. With no fixed conditions, the prompt alone determines the match.
- Fixed conditions with an empty prompt run without an AI request. An enabled configuration with neither conditions nor a prompt uses the label name and description.

The Gmail and managed-mail processors partition deterministic matches before checking the AI budget. Deterministic matches can still apply while AI work is deferred. Existing event records retain retry and usage-reporting behavior. Gmail development observation mode still prevents provider writes.

## Rollout and local verification

Migration `20261019214319_serious_retro_girl` adds nullable JSONB columns to `gmailLabel` and `managedMailLabel`. This is an additive expand step. Apply the migration before deploying the code that reads these columns. Production migrations use the protected deployment workflow. For an approved development database, follow the migration steps in [Development](development.md).

The existing Gmail and managed-mail preview personas support creating and editing auto-labels in browser storage, scoped to the demo mailbox. These fixtures do not call a model or modify external mailboxes. They exercise the preset library, custom label creation, existing-label configuration, input validation, saving, reloading, and the responsive layout. Preset examples are synthetic illustrations, not classification results or messages from the user's inbox.
