# Visual email builder and campaign pages

Implements QUIETER-100 and its existing editor, rendering, and export children, QUIETER-132, QUIETER-133, and QUIETER-134. Preserves the version-one compose document foundation from QUIETER-131.

## Product and layout

- Give Templates a dedicated workspace alongside Audiences and Campaigns. Show visual previews in the library, with compact names and actions.
- Make the email canvas the primary element. Keep a small block palette at one edge and contextual content/style controls at the other. Use Quieter's current components, spacing, semantic tokens, and typography. Remove introductory paragraphs and repeated helper copy.
- Provide heading, text, image, button, divider, and spacer blocks, selection, duplication, reordering, deletion, undo/redo, and desktop/mobile preview. Start with a practical single-column email layout.
- Move campaign creation, content, audience selection, and final review onto dedicated routes. Preserve the existing durable delivery report. Small secondary actions may use dialogs; the sending workflow does not.
- Use the Klaviyo and Flodesk editor screens reviewed in Mobbin as layout references, without copying their visual design.

## Content and persistence

- Add a strict, bounded version-two email design with validated theme tokens. Render email-safe tables and inline styles with plain-text alternatives. Keep the current compose document unchanged.
- Support explicit plain-text, visual-design, and imported-HTML content. Imported React Email output retains its HTML source; arbitrary source code is never executed in the app. Editable designs round-trip through JSON. Export visual designs as HTML, JSON, and React Email source.
- Validate supported flat theme values and recognized design tokens before applying them. Failed imports leave the current email intact. Explain unsupported input with field-level validation.
- Store reusable team templates with optimistic concurrency, duplicate/archive/restore, and idempotent creation. Keep organization authorization and explicit template scopes across interfaces.
- Add campaign content and rendered HTML additively, keeping legacy text requests valid. Copy template content into the draft rather than following a mutable template during delivery. Include content in review hashes, credit estimates, immutable delivery state, and both HTML/text unsubscribe footers.

## API, SDK, and MCP

- Add template management/render/export operations to the shared control registry and generated OpenAPI/MCP discovery. Expose the same functionality in the typed core SDK.
- Extend the optional React SDK entry to render React elements for template creation/update and campaign creation/update. Derive text when omitted. Preserve the explicit preview, confirmation, idempotency, and recipient-snapshot requirements for campaign sends.
- Keep the core SDK and backend delivery path independent of React rendering. Restrict imported HTML, isolate previews in sandboxed frames, and never evaluate uploaded JSX or JavaScript.

## Verification and rollout

- Generate and inspect additive database migrations, run db:check, and apply only to the approved development database. Check affected AWS/Cloudflare deployment boundaries and bundles.
- Add focused safety coverage for parsing, HTML rejection, token imports, rendering/export, and template authorization/concurrency where needed. Run the full checks and existing test suite for the combined behavior change.
- Manually verify library creation, editing, undo/reordering, responsive preview, import/export, React SDK handoff, dedicated campaign steps, review invalidation, and cancellation/dry-run delivery using synthetic data.
- Record and stop only task-owned preview processes. Update operational/API docs, capture screenshots, commit, push, and update the existing integrated feature PR. Production migration, deployment, and real provider sends remain protected actions.
