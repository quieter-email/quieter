# Visual email documents

Reusable templates store a versioned document in `mailTemplate.document` alongside their rendered `bodyHtml`. The shared contract is exported from `@quieter/mail/visual-email`. Version 1 represents the current compose editor's paragraphs, text formatting, links, lists, quotes, code, separators, remote images, and template placeholders. The document is editor-compatible JSON wrapped in `{ version: 1, content: { type: "doc", content: [...] } }`.

The template workspace saves the editor document and reopens it directly. The server validates every document before writing, then derives the stored HTML from the document. Supplying different HTML cannot override that result. Existing HTML-only requests still work; omitting or clearing `document` replaces the source with HTML-only content, so old clients cannot leave a stale document behind. Personal ownership, team membership, and owner/admin editing permissions apply to both formats.

Validation rejects unsupported versions, nodes, attributes, unsafe links, temporary image references, and excessively large or deeply nested content. The editor keeps the current content after a rejected save. If stored source cannot be read, listing returns its HTML with a recovery message instead of failing the template list. Editing and saving that content replaces the invalid source with a valid document.

Compose inserts the rendered HTML through the existing template picker and placeholder hydration. The ordinary draft and send pipeline continues to own recipients, unresolved placeholder checks, attachments, permissions, and send confirmation. A template document does not authorize sending or carry attachment credentials. Image files need a durable upload lifecycle before they can become reusable template content.

The visual builder's additional layout blocks, email-client rendering and preview validation, design tokens, and export formats remain separate work in QUIETER-132, QUIETER-133, and QUIETER-134. The current renderer supplies a safe semantic HTML handoff for the compose-supported content.

## Local development and release

Use the existing development environment and allowlisted `quieter_dev` database. Run `vp run env:doctor`, then `vp run db:migrate` and `vp run dev`. No new service or secret is required. The local sign-in page's **User with Gmail** persona supplies an owned test mailbox and development session; template operations persist in the development database while mail content uses synthetic fixtures. In Templates, create a message containing formatting and a placeholder, save it, switch templates, reopen it, edit and save, then insert it from the compose template picker. Keep shared mailboxes in observation mode; the template lifecycle does not require a provider write or a real send.

For isolated validation without a database or provider credentials, run `vp test packages/mail/tests/visual-email.test.ts packages/orpc/tests/mail-templates.test.ts`.

The migration adds one nullable JSON column. Apply it through the protected production migration workflow before releasing code that selects the column. Existing templates remain HTML-only until saved from the document-aware editor. No backfill or contract migration is required, and earlier clients can continue saving HTML-only templates.
