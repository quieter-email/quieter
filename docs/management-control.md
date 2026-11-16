# Management control authority

The management API controls the signed-in user's Quieter application resources. It is separate from transactional sending. A transactional organization API key proves permission to send from a verified domain. It does not identify an acting user or grant inbox, calendar, organization administration, or personal-context access.

This document records the authority contract, shared wire contracts, read HTTP adapter, approved local settings changes, and application capability inventory. They live in `packages/orpc/src/control/`. External credential issuance, management MCP, and the management SDK are separate deliverables. A registry entry describes an application operation. It does not prove that a public adapter implements it.

## Credentials and scope

The initial server authority boundary accepts a current application session. It derives the actor and session identity server-side. It rejects requests with an Authorization credential, including a transactional key accompanied by a valid session cookie. An adapter must not reinterpret a failed bearer credential as session authentication.

Delegated management bearer credentials are unsupported until a separate verified credential path exists. A JSON object containing a user identifier, role, or claimed scopes is never a credential. Transactional key verification must not construct a management identity. Reusing a key table or authentication library in a future implementation does not remove the need for a separate credential audience, verifier, and revocation path.

Each server adapter explicitly supplies its implemented operations and granted scopes. Request arguments select a target within that authority. Client-supplied scope headers do not grant authority. Discovery and execution intersect the adapter's operation set, scopes, current session, current resource access, and existing resource capabilities. Discovery results are advisory and must not be cached as durable authorization.

Targets have distinct meanings:

| Target | Authority |
| --- | --- |
| Current user | Only the authenticated actor. There is no caller-selected user identifier. |
| Organization | Current membership, with admin or owner authority for settings management. |
| Mailbox | Explicit mailbox and organization, owned Gmail or a current managed-mail grant. The selected organization must match the mailbox's actual organization. |
| Calendar account | Explicit connection owned by the authenticated actor. A mailbox grant does not grant access to another user's calendar account. |

Organization membership does not reveal private Gmail or private managed mailboxes. Managed direct and division grants retain their existing role rules. Division grants apply only to shared managed mailboxes. Private managed owners retain their established access. Credential delegation, when implemented, can narrow the actor's current permissions; it cannot add another user's authority.

Every execution repeats current authentication and target authorization. A revoked session, removed member, revoked mailbox grant, or unavailable calendar connection must fail at execution even if discovery previously succeeded. Downstream application services also retain their own checks. Workers use the existing request-scoped database client lifecycle.

## Application coverage inventory

The table distinguishes the first management milestone from the broader dashboard. All operations remain available only through their existing application or transactional entry points until their management adapter is implemented and verified.

| Dashboard capability and source | Management milestone | Boundary and remaining coverage |
| --- | --- | --- |
| Mailbox discovery, `routers/mail/mailboxes.ts` | Initial read contract | Preserve existing mailbox groups, preferences, default selection, connection state, and capability enrichment. Filter to granted targets without exposing inaccessible mailboxes. |
| Mail list, provider search, thread read, `mail/queries.ts` | Initial read contract | Call complete application operations. Preserve managed and Gmail dispatch, importance and unsubscribe metadata, source references, revisions, and current coverage limits. No raw provider shortcuts. |
| Calendar accounts, calendars, events, `calendar/service.ts` | Initial read contract | Only the actor's explicit accounts and supported existing reads. Reauthentication and unavailable sources remain visible. Availability proposals wait for the separately integrated service. |
| Read state, placement, labels, importance, `mail/mutations.ts` | Mutation authority contract | Provider-neutral supported actions only, with the existing mailbox capabilities and exact target. External execution requires the mutation protections below. Permanent deletion is not supported by current mailbox capabilities. |
| Drafts and sends, `mail/compose.ts` | Later approved mutation contract | Keep draft preparation distinct from sending. Reuse compose locks, send safeguards, scheduled-send receipts, and truthful Undo Send cutoffs. No direct provider send path. |
| Draft and message attachments, delivery status, inspector, `mail/queries.ts` | Additional coverage pending | Preserve attachment ownership and output sanitization. Do not expose raw provider credentials or database records. |
| Mail capture, sync, verification codes, useful details, `routers/mail.ts` and `routers/mail/mailboxes.ts` | Additional coverage pending | Sync and preparation may enqueue work. Sensitive verification-code access needs a separate explicit capability decision. |
| Mailbox creation, deletion, signatures, connection and grants, `routers/mail/mailboxes.ts` | Unsupported in initial adapters | Reuse organization management and mailbox administration checks. Consent remains browser-only. No external credential return or grant escalation. |
| Managed rules, labels and backfills, `routers/mail/managed-organization.ts` | Unsupported in initial adapters | Preserve organization authority, cancellation, backfill receipts, and mutation approval. |
| Organization divisions, delivery settings, suppressions and tracking, `routers/organization.ts` | Additional organization contract pending | Membership is distinct from admin or owner authority. Suppression changes remain separate from inbox mutations. |
| Account preferences, onboarding, `routers/account-preferences.ts` and `routers/onboarding.ts` | Additional user contract pending | Only the actor's preferences. Existing defaults and provisioning behavior remain application-owned. |
| Mail snippets, `routers/mail-snippets.ts` | Additional coverage pending | Preserve mailbox scope and ownership. |
| Search history, preparation and pause, `routers/search.ts` | Unsupported in initial read-only adapters | History currently requests indexing. Do not advertise indexing, preparation, or pause as passive external search. |
| AI settings, personalization and memory, `routers/ai.ts` | Unsupported in initial adapters | Personal context remains private. Future AI context loads through `loadAiAgentContext`; mailbox access alone never grants another user's memory. |
| Chat and transcription, `routers/chat.ts` and the chat route | Unsupported in initial adapters | Preserve mailbox/session scope. G owns in-app tool composition and shared AI policy. |
| Actions and automation, `routers/mail-agent.ts` | Additional contract pending | Reuse reviewed manifests, exact connector bindings, current grants, read-only policy, pause, and audit. No parallel authority implementation. |
| Private reminders, `routers/reminders.ts` | Unsupported in initial adapters | A shared mailbox grant does not share the actor's reminders or personal context. |
| Scheduled sends, `routers/scheduled-sends.ts` | Later approved mutation contract | Preserve operation identity, cancellation, recovery and uncertain outcomes. Do not retry ambiguous sends as new operations. |
| Connectors, `routers/connectors.ts` | Unsupported in initial adapters | Owner-only accounts, browser consent, current grants, and provider secrets remain server-side. |
| Domains, DNS and receipt routing, `routers/mail-domains.ts` | Unsupported in initial adapters | Existing organization administration and protected infrastructure workflows remain required. |
| Billing and organization usage, `routers/billing.ts` and `routers/organization-mail-usage.ts` | Unsupported in initial adapters | No implicit billing, pricing, funding, or spending authority. |
| Platform operations and waitlist settings, `routers/operations.ts` | Unsupported | Platform authorization is distinct from organization or mailbox management. Never infer it from a management credential. |
| Transactional sending, delivery and suppressions, existing public REST and MCP | Separate product boundary | Keep their credential configuration, endpoint names, SDK, documentation, and billing checks separate. They do not satisfy management acceptance. |

Mail reads may maintain internal capture and enrichment state through the established application path. A read-only management capability means it cannot request a user-visible mailbox mutation. It does not justify removing required source enrichment or silently triggering a different indexing workflow.

## Mutation contract

These rules are requirements for mutation execution adapters. QUIETER-125 does not introduce durable approval, replay, or audit storage and does not claim that metadata alone enforces these rules.

An exact-action approval binds the authenticated actor, credential identity, operation, explicit organization/mailbox/account target, normalized complete arguments, expiry, and a unique approval identity. The user sees the exact action before approving it. Changed arguments, a different mailbox, a different actor, expired consent, or an approval replay requires rejection. A boolean `confirmed` field is not an approval receipt. Execution reloads current grants and the shared AI policy after approval.

Idempotency binds the actor, credential, operation, explicit target, request key, and normalized payload fingerprint. The same key and same request return the original durable receipt. A different payload conflicts. Concurrent claims must converge through durable storage, including across Workers and adapters. Provider timeouts and partial results remain uncertain until reconciled. They must not become fresh sends on retry. An in-memory map or an unprotected read-then-write is insufficient.

The application command owns the durable state transition and audit outcome. Destructive actions require a separately reviewed supported command, explicit confirmation, and the same replay protections. The initial external surfaces must not advertise unsupported irreversible actions. Cancel, retry, draft, send, and Undo are distinct operations with distinct outcomes. Undo is available only before the actual application cutoff.

Audit discovery, authorization denial, approval, execution, cancellation, replay, and recovery with operation and outcome metadata. Protected audit storage may retain opaque actor/resource/credential identifiers for accountability. Analytics and error telemetry must not receive those identifiers, email addresses, message or draft content, search text, private URL parameters, or credentials. Do not use telemetry as the durable audit ledger.

## Adapter obligations

Use the shared registry for operation requirements and discover only operations the adapter actually implements. Unknown or unimplemented operations fail closed. Repeat authorization immediately before application execution and retain the application's own checks. Public request schemas never accept acting-user identity or resource roles.

Use the established mail and calendar application services. `queriesMailOperations` preserves provider dispatch, source capture, importance, unsubscribe information, and content revisions. Calendar services preserve account ownership and provider error handling. Adapters must not query the database or call Gmail REST directly.

HTTP and MCP adapters share runtime request/result schemas with OpenAPI and the separately named management SDK. Public output contains provider-neutral application results and canonical source references. Provider tokens, encrypted credentials, database-shaped internal records, and another user's private context are excluded. Authentication failures, denied scope, expired confirmation, idempotency conflict, cancellation, reconnect requirements, partial results, and uncertain execution need safe explicit outcomes.

## Shared runtime and OpenAPI contracts

`control/contracts.ts` owns the operation input and result schemas, discovery output, safe errors, and mutation receipt states. Types derive from these schemas. Inputs carry their explicit resource identifiers once and reject extra actor, role, or credential claims. Calendar reads reuse the existing calendar schemas, including their runtime date-range and time-zone checks.

`control/openapi.ts` generates OpenAPI 3.1 from those same schemas and operation requirements. The server supplies the selected operation IDs to `createControlOpenApiDocument`. Selection describes the adapter's implemented coverage; it does not grant authorization. Every selected operation uses a JSON POST under `/api/control/{operation}` so private search text stays out of request URLs. The management version header is `Quieter-Control-Version`. It is separate from transactional API versioning.

For example, a server boundary parses a thread request with `controlContracts["mail.read_thread"].input.parse(body)`. The request contains `mailboxId`, `organizationId`, and `threadId`. It then authorizes the operation with the current request headers and calls the complete application thread operation using the server-derived actor. The result schema validates the public response. This contract source does not publish that HTTP route by itself.

Mail search retains the application's opaque `pageToken` and `nextPageToken` convention. Continue with the same mailbox, organization, category, and query. A page and its size estimate do not establish complete mailbox coverage. Adapters must bind any stored cursor to that request scope and reauthorize every page.

`toControlMailMessage` projects the enriched application message into the public schema and adds an explicit mailbox/thread/message source reference. Its root application link encodes these identifiers with `URLSearchParams`. It preserves useful optional read state, importance, recipients, threading, bodies, attachments, inline images, draft anchors, and unsubscribe state. Credentials, private action keys, and internal provider records are excluded. External links cannot rely on the in-app chat reference's implicit active mailbox.

Errors use a named code and safe message, with optional request and retry metadata. The schema strips unrecognized fields; adapters must still select a safe message rather than copy an unexpected exception. Mutation results distinguish pending and uncertain execution from succeeded, failed, and cancelled outcomes. A successful mutation result requires its completed receipt and typed result. These schemas do not create durable execution records.

Settings, organization, and automation schemas define representative broader contracts. They remain unadvertised until an adapter implements and verifies the corresponding application path. Streaming is unsupported. OpenAPI describes the shared JSON shapes; runtime validation remains authoritative for cross-field calendar constraints that JSON Schema cannot express.

The pure contract leaves can be bundled into a separately named standalone management SDK, following the existing workspace contract-bundling pattern. A client distribution must not import server authority, database, environment, or provider modules. The SDK's built artifact and external-client acceptance still require verification in their own units.

## Initial read HTTP adapter

`createControlReadRuntime` is the shared application boundary for the initial read surface. Its default services call the existing protected application routers through oRPC's server caller. Mailbox ordering/default selection, mail source dispatch and enrichment, and calendar ownership remain in those application paths. The HTTP mount consumes this runtime through `@quieter/orpc/control/http`; an in-app caller can consume the package-owned runtime without importing application code.

The read runtime implements these operations:

| Operation | Explicit input scope |
| --- | --- |
| `mailboxes.list` | Current authenticated user. |
| `mail.search` | Organization and mailbox, category, optional query and page token. |
| `mail.read_thread` | Organization, mailbox, and thread. |
| `calendar.accounts` | Current authenticated user. |
| `calendar.list` | Owned calendar connection. |
| `calendar.events` | Owned connection, calendar, bounded time range, and time zone. |
| `calendar.event` | Owned connection, calendar, and event. |

Synthetic API mailboxes use their existing organization-membership path and read-only API capabilities. Gmail and managed mailboxes keep their existing ownership and grant checks. Every page and thread request reauthorizes its explicit target. Read discovery never grants a write operation.

`POST /api/control/capabilities` accepts the strict target object from the shared contract. For example, `{"kind":"user"}` discovers user-level operations. A mailbox target includes its organization and mailbox IDs. `GET /api/control/openapi` returns only the adapter's implemented, scope-enabled contract paths. Both require a current application session and the management version header. Unknown operations remain unavailable. The default HTTP adapter also implements the local settings change described below. An explicitly supplied read runtime remains read-only.

Use the existing local development startup and a development session cookie jar stored outside Git. For example:

```bash
curl --cookie /path/to/development-cookie-jar \
  --header 'Quieter-Control-Version: 2026-11' \
  --header 'Content-Type: application/json' \
  --data '{"kind":"user"}' \
  http://127.0.0.1:3000/api/control/capabilities
```

Send operation parameters as JSON to `/api/control/{operation}` with the same headers and session. The adapter rejects transactional/API-key headers even if a valid cookie is also present. It limits request bodies, rejects unsupported content types and client identity claims, forwards cancellation, and returns private, uncached responses. Expected denials use safe named errors; unexpected failures are reported without forwarding private request details to the caller or telemetry.

The HTTP adapter does not issue management credentials or persist cursor bindings. Callers must continue pages with the same target, category, and query. Existing provider pagination and fresh resource authorization remain authoritative.

## Approved local settings changes

`createControlApplicationRuntime` composes the read runtime with `createControlMutationService`. Its only implemented mutation is `organization.settings.update` for the organization's `openTrackingEnabled` and `allowPerSendOverride` settings. Organization discovery requires current owner or admin authority. Mail, calendar, automation, and provider mutations remain unavailable.

The existing web development startup mounts these routes through `/api/control/$`. No additional service, secret, or background process is required. The coordinator-owned management journal migration must already be applied through the approved database workflow. Do not push the schema to a shared database to enable this feature.

To request a change:

1. Send JSON to `POST /api/control/mutations/prepare` with an explicit `organizationId`, a fresh `idempotencyKey`, and at least one of the two boolean settings. Use the same session and version headers as read operations. Omit settings that must remain unchanged. Preparation stores the exact request and has no settings effect.
2. Open the returned `reviewPath` in the signed-in browser using that same session. The static `/control/review` page reads the approval ID from its query string. It shows the organization, requested values, expiry, and current state. The page never approves or executes on load.
3. Choose **Approve change** to record approval, or **Cancel change** to cancel a pending request. Approval alone does not execute the change. Approvals expire ten minutes after preparation and cannot be extended by replay.
4. Send the original settings, organization, and idempotency key plus the returned row ID as `approvalId` to `POST /api/control/organization.settings.update`. A successful response contains the stored receipt and both resulting boolean values.

`POST /api/control/mutations/review` and `POST /api/control/mutations/cancel` accept only `{ "id": "<approval UUID>" }`. The browser sends approval to `POST /api/control/reviews/approve` with the same strict body. That endpoint requires an exact same-origin `Origin`, `Sec-Fetch-Site: same-origin`, JSON content, and `X-Quieter-Review: approve`. Approval is excluded from the operation registry and OpenAPI discovery. A supplied `confirmed` flag never grants approval. These browser checks prevent cross-origin approval requests. They do not attest physical human presence or constrain a client that already controls the user's session.

The review ID stays out of pathname analytics. Before sending Sentry errors or streamed spans, the web router removes private review URL query and fragment values, including encoded sign-in return URLs, referrers, and navigation breadcrumbs. The filter preserves unexpected error reporting and unrelated URLs. Installed-SDK transport tests cover the automatic URL collection paths.

Every command revalidates the authenticated session against its current database row and requires current organization authority. Requests belong to one actor and session. A replacement session cannot consume an older approval. The service pins current session and membership rows with nonblocking locks, bounds other lock waits, and retries only transactions known to have rolled back for lock or serialization conflicts. Session revocation, role changes, cancellation, and organization deletion cannot silently bypass those checks.

The canonical settings setter, successful journal receipt, and executed audit event commit in one transaction. Time and cancellation are checked again after writes and lock waits. An abort observed before the final commit decision rolls the transaction back. A connection loss during or after commit can hide a successful result. Recover by repeating the same request with its original key and approval ID. Never use a new key to guess whether execution completed. A successful replay returns its original result before checking approval expiry and never reapplies the settings, even if another change has since modified them. Current session and role checks still apply to replay.

The request fingerprint uses `v1:` followed by the lowercase SHA-256 digest of the normalized API version, operation, explicit organization, and exact patch. Omission differs from an explicit `false`. Reusing a key with another patch or organization conflicts. Terminal requests cannot return to pending states, and cancellation cannot undo a successful change. Safe denied or failed attempts are audited outside a rolled-back command without copying unvalidated target IDs or arbitrary request metadata.

For focused native verification, use Docker and run:

```bash
vp run @quieter/env#build
vp run @quieter/observability#build
vp test packages/orpc/tests/control-mutations.native.test.ts --mode control-native --maxWorkers=1
```

The test owns one temporary loopback PostgreSQL fixture with a 512 MiB memory limit and at most three connections. It requires at least 3 GiB available memory, records its resource IDs under the system temporary directory, and stops its own resources. It exports the relevant schema and existing lifecycle triggers into that disposable fixture. It never applies a shared migration. The dedicated management mutation workflow runs the same checks in CI. The default test mode skips this Docker fixture.

## Evidence boundaries

Focused security tests exercise the authority boundary with synthetic authenticated sessions and resource-service responses. They verify denial, narrowing, target binding, current-grant revalidation, and transactional credential separation. Existing mailbox-access services remain the source of grant semantics.

Native settings tests exercise the real setter, transaction, journal, audit events, and current database session and membership rows. A production-handler loopback test drops a successful HTTP response and verifies that replay returns the stored receipt without applying the settings again. Authentication resolution is synthetic in these tests. Browser approval, real development-session acceptance, provider writes, external credential issuance, and MCP mutation acceptance require their own evidence. The separate management MCP read runtime gains no mutation from this HTTP composition.
