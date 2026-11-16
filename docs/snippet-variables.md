# Snippet variables

Snippets remain mailbox-scoped reusable plain text. Inserting a snippet resolves a copy for the current composer. It never updates the stored original.

| Marker | Value |
| --- | --- |
| `{{@sender.name}}` | The current sender name, using the same mailbox and permitted sender-name override as sending. |
| `{{@sender.email}}` | The current sending mailbox address. |
| `{{@recipient.name}}` | The explicit display name of a single valid To recipient. |
| `{{@recipient.email}}` | The address of a single valid To recipient. |
| `{{?field}}` | A value to fill during insertion or in the draft before sending. |

Multiple To recipients, an absent display name, missing context and unknown context markers become required fields. No contact lookup, inferred first name, Cc/Bcc selection or other mailbox data supplies a value. Names are case-sensitive, start with an ASCII letter and contain up to 64 letters, digits, dots, underscores or hyphens.

The insertion dialog supports Tab and Shift+Tab. Cancel or Escape leaves the document and slash query unchanged. Confirmation checks that the document, mailbox and resolved context still match the captured insertion. Blank values remain visible markers. Supplied values are inserted as text and are not recursively expanded.

Only the explicit `@` and `?` forms are reserved. Existing generic text such as `{{name}}` and malformed markers stays literal. An existing snippet containing a valid reserved marker adopts this behavior. An odd number of immediately preceding backslashes escapes a marker; an even number leaves it active. Backslashes remain in the message, including the escape, so draft round trips cannot accidentally reactivate a literal marker. Replacement text containing active markers is still caught at send time.

Draft saving and recovery permit incomplete fields. The composer checks both body alternatives before ordinary or scheduled send admission. The shared send-input schema also rejects active unresolved markers, including decoded HTML entities and markers split across inline formatting. HTML attributes, comments and non-content elements do not supply fields; block boundaries do not join markers. The server helper `assertSnippetFieldsResolved` provides the same expected pre-send error for internal send adapters.

Assistant admission and final dispatch use the same scanner through the G-owned send-boundary integration. That join must be pinned and reviewed before assistant warning acceptance is claimed. Mailbox authorization, durable operation identity, held-send cancellation and attachment restoration retain their existing contracts.
