# Automatic labeling

The Labels workspace shows existing labels and nested groups. Groups organize labels within one mailbox. They leave label names, message assignments, and automation settings intact. Each label has an auto-label switch and a Prompt button. Saving a prompt preserves the label's enabled state. The mailbox-wide switch controls whether new mail is labeled automatically.

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

## Suggestions

The conversation label picker can suggest a previously auto-applied label that is absent from the conversation. For new classifications, it can also show labels with an independent match score from 0.60 up to the existing 0.65 auto-apply threshold. These candidates come from the same classification request. Older events can supply past applications, and new events also retain these additional candidate IDs.

## Rollout and local verification

Migration `20261019214319_serious_retro_girl` adds nullable JSONB columns to `gmailLabel` and `managedMailLabel`. This is an additive expand step. Apply the migration before deploying the code that reads these columns. Production migrations use the protected deployment workflow. For an approved development database, follow the migration steps in [Development](development.md).

Migration `20261127152920_bitter_pete_wisdom` adds the mailbox label organization table and a nullable suggestion column on classification events. Apply this additive migration before releasing the new readers and writers.

The Gmail and managed-mail preview personas store label and group edits in browser storage, scoped to the demo mailbox. In the Gmail preview, open **Onboarding checklist draft** to exercise suggested labels with sample data.
