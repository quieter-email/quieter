# Audiences and broadcast campaigns

Implements QUIETER-151 and its children QUIETER-158, 159, 160, 161, 168, 169 and 170.

## Backend plan

- Add canonical organization contacts, audiences, audience memberships with tags, deterministic tag-based segments, and append-only lifecycle events. Store event occurrence and recording time, actor, channel, consent source, and reason.
- Keep subscription state separate from the existing organization safety suppression list. Imports and ordinary registration cannot restore inactive membership or clear suppression. Explicit resubscription records fresh consent. Serialize membership mutations and snapshot creation so concurrent changes have a defined order.
- Bound bulk imports, validate each row, normalize addresses, identify duplicates, and return row-level outcomes. Repeated idempotency keys must return the prior result or reject changed input.
- Add campaign drafts and immutable recipient snapshots, including excluded recipients and selection criteria. Freeze content and selection when the user confirms a send. Keep durable campaign recipient state independently of transactional-send retention.
- Process campaigns in bounded server-side batches with leases and stable per-recipient send keys. Reuse verified sender checks, plan and credit gating, suppression, raw message storage, delivery feedback, and credit reservations. Check current membership and suppression immediately before submission. Never retry an uncertain provider acceptance as a new send.
- Cancel unsent work and preserve accepted results. Resume safe transient failures without restarting accepted recipients. Aggregate delivery and engagement from provider-neutral events joined to frozen recipient records.
- Add opaque, recipient-specific unsubscribe capabilities. GET displays a confirmation page and has no subscription side effect. RFC 8058 POST changes audience subscription immediately, without login or redirects. Add the unsubscribe headers and a visible footer to every broadcast.
- Add shared actor and scope authorization for app, control API, SDK, and MCP. Organization members can read; owner/admin can manage and send. Existing transactional credentials gain no audience or campaign access by default. All programmatic management access requires explicit scopes.
- Generate runtime and OpenAPI schemas from shared provider-neutral contracts. Add typed SDK operations and scope-filtered MCP discovery, including explicit confirmation and idempotency for sending.

## Frontend plan

- Add dedicated organization-scoped Audiences and Campaigns routes linked from the mail sidebar. Use the existing application shell and team selection, shared UI primitives, semantic colors, typography, density, and error handling.
- Audience list and detail views include creation, search, filtering, contacts, tags, segments, consent source, subscription state, separate suppression state, and chronological history. Contact actions include edit, unsubscribe, explicit resubscribe, and removal.
- Bulk import previews invalid and duplicate rows before mutation and displays row-level results afterward. Start with bounded CSV/paste import rather than an unbounded upload pipeline.
- Campaign list and detail include saved drafts, active and completed runs, progress, recipient outcomes, and delivery evidence. The browser observes server delivery and never drives it.
- Build a safe basic text composer with sender, subject, body, audience and segment selection. Save drafts on explicit save and preserve unsaved navigation state. Review shows the sender/domain, target criteria, eligible/excluded counts, cost estimate, and content before explicit confirmation.
- Support narrow screens and labeled keyboard/touch controls. Reuse shared confirmation dialogs, fields, lists, pills, and progress components.

## Verification and rollout

- Use an additive migration generated from schema.ts and review constraints, indexes, tenant foreign keys, and cascade behavior. Run db:check. Apply only to approved development resources for local verification.
- Use the existing ignored development configuration from the main checkout, verify database isolation, and run env:doctor. Record and later stop only processes created for this task.
- Manually exercise audience creation, import validation, segmentation, history, saved drafts, review, cancellation, reporting, and unsubscribe in Chrome. Keep real bulk sends restricted to dedicated test recipients and approved local send settings.
- Add focused safety tests only for authorization, validation edge cases, consent ordering, idempotency, and concurrency. Run vp check --fix, vp test, and relevant handler boundary/bundle checks. Build where needed for route generation and deployment verification.
- Document startup/worker setup and the API contract. Commit, push, check for an existing branch PR, and create a PR with screenshots when possible.

## Operational boundaries

No production migrations, deployment, paid infrastructure provisioning, or production bulk send is included in local implementation verification. Uncertain sends remain pending confirmation instead of risking duplicate delivery. The initial composer supports plain text; visual template editing remains independent.
