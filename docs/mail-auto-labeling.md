# Automatic labeling

The Labels workspace is one list of the mailbox's existing labels. Each label has an auto-label switch and a Prompt button. The prompt dialog contains only the AI instruction and Cancel / Save actions. Saving a prompt preserves the label's enabled state. The mailbox-wide switch controls whether new mail is labeled at all.

## Matching

Both mailbox providers store the same nullable `autoLabel` settings on each label. Prompts can describe sender addresses, domains, recipient addresses, or the message's purpose. The classifier receives the stored From, To, Cc, and Bcc fields alongside the message content. Delivery addresses absent from those headers are unavailable.

When an older configuration has fixed conditions, the editor converts them into readable instructions. Saving a valid prompt clears those fixed conditions so no hidden filters remain. If the converted text exceeds the prompt limit, saving it unchanged preserves the original configuration without truncation. Editing a prompt does not enable a paused label. An empty prompt uses the label name and description.

## Earlier fixed conditions

The JSON contract still accepts earlier sender, recipient, domain, and keyword fields. Configurations that have not been edited keep their existing matching behavior. The contract lives in `@quieter/mail/auto-label`, and the deterministic matcher in `@quieter/mail/auto-label-matching`.

- A null configuration preserves existing AI classification using the label name, description, and legacy inclusion criteria.
- A configuration with `enabled: false` excludes that label from automation.
- Sender conditions match an exact parsed email address. Display names cannot satisfy them.
- Recipient conditions match exact parsed addresses in To, Cc, or Bcc, ignoring case and display names. They can distinguish addresses delivered to a catch-all inbox. Hidden delivery recipients that are absent from the stored headers cannot match. Existing settings can omit the recipient field.
- A domain such as `example.com` matches only that domain. `*.example.com` matches one or more subdomain levels, excluding the main domain. Add both patterns to include both.
- Keywords are case-insensitive literal substrings or phrases. They can match the subject, body, or either.
- Entries within a field are alternatives. Match all or Match any combines the nonempty sender, recipient, sender domain, and keyword fields.
- A nonempty AI prompt adds an AI confirmation after those conditions match. With no fixed conditions, the prompt alone determines the match.
- Fixed conditions with an empty prompt run without an AI request. An enabled configuration with neither conditions nor a prompt uses the label name and description.

The Gmail and managed-mail processors partition deterministic matches before checking the AI budget. Deterministic matches can still apply while AI work is deferred. Existing event records retain retry and usage-reporting behavior. Gmail development observation mode still prevents provider writes.

## Rollout and local verification

Migration `20261019214319_serious_retro_girl` adds nullable JSONB columns to `gmailLabel` and `managedMailLabel`. This is an additive expand step. Apply the migration before deploying the code that reads these columns. Production migrations use the protected deployment workflow. For an approved development database, follow the migration steps in [Development](development.md).

The existing Gmail and managed-mail preview personas support creating, editing, and deleting labels, switching auto-labeling on or off, and editing prompts in browser storage, scoped to the demo mailbox. These fixtures do not call a model or modify external mailboxes. They exercise the dialogs, saving, reloading, and the responsive layout.
