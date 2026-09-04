# Architecture

## System Overview

```mermaid
flowchart LR
  Browser["Browser / TanStack Start"] --> Web["apps/web"]
  Web --> ORPC["packages/orpc"]
  ORPC --> DB["PostgreSQL"]
  ORPC --> Gmail["packages/gmail / Gmail API"]
  ORPC --> Mail["packages/mail"]
  ORPC --> Billing["packages/billing / Polar"]
  ORPC --> AI["packages/ai / OpenRouter"]
  Cloudflare["Cloudflare Workers, Queues, Durable Objects"] --> ORPC
  AWS["packages/aws / SST"] --> ORPC
  Cloudflare --> DB
  AWS --> DB
  AWS --> MailInfra["SES, S3, SNS, Lambda"]
```

Behavior-producing AI agents share the scoped dynamic knowledge boundary in [`docs/ai-memory.md`](./ai-memory.md). Personal knowledge follows one user, mailbox knowledge follows the mailbox and is more specific, and all retrieval and mutation goes through `packages/orpc/src/ai-memory.ts`.

`apps/web` owns routing, rendering, browser state, server functions, and HTTP API handlers. Database-backed business logic crosses through `packages/orpc`. Shared packages own provider and domain-specific behavior.

## Workspace Boundaries

### `apps/web`

TanStack Start application containing:

- file-based routes and request handlers
- root providers and the HTML document
- mailbox, message, compose, chat, settings, auth, and legal features
- TanStack Query configuration and persisted caches
- consent-gated browser analytics

API handlers remain under `apps/web/src/routes/api/**`. Request-scoped auth and SSR data use route loaders or TanStack Start server functions.

### `packages/orpc`

The application and database boundary. It owns:

- oRPC routers and authorization
- mailbox access resolution
- chat persistence and streaming orchestration
- Gmail credential encryption and refresh
- managed mailbox operations
- organization mail policy and usage
- billing-backed entitlements

No application module should bypass this package to query PostgreSQL.

### `packages/database`

Owns the Drizzle schema, client, migrations, schema-drift checks, and migration safety tooling.

### `packages/mail` and `packages/gmail`

`packages/mail` contains provider-independent mail behavior: schemas, MIME construction, raw parsing, content extraction, draft anchors, and avatar derivation.

`packages/gmail` contains Gmail REST calls and Gmail-specific draft parsing. It does not own encrypted credential storage or token refresh.

### Other Packages

- `packages/auth`: Better Auth setup, identity scopes, organizations, API keys, passkeys, and auth mail
- `packages/ui`: reusable Base UI-backed components
- `packages/ai`: model selection, prompts, classification, titles, and streamed generation
- `packages/aws`: SES mail ingestion, delivery feedback, and AWS-specific handlers
- `packages/cloudflare`: Gmail notification ingress, queued synchronization, scheduled maintenance, and mailbox live synchronization
- `packages/billing`: plans, Polar checkout/webhooks, entitlements, and usage pricing
- `packages/env`: typed environment schemas and normalization
- `packages/deployment`: deployment helper scripts

## Identity and Mailboxes

Google sign-in and Gmail authorization are separate:

- Google sign-in requests identity scopes only.
- Gmail authorization uses a dedicated OAuth client, PKCE, and Gmail scopes.

Every connected Gmail account and managed address is a persisted mailbox with a stable generated ID.

- Gmail mailboxes remain private to their owner, even when placed in an organization.
- Managed mailboxes are organization-owned and visible only through explicit mailbox grants.
- Personal is always available but is not a Better Auth organization.
- `user.defaultMailboxId` is the global fallback across Personal and organizations.

Mailbox-scoped state, queries, caches, chats, compose sessions, and mutations must always include `mailboxId`.

## Gmail Synchronization

The browser initially loads mailbox state through oRPC. Gmail REST work runs server-side.

Unfiltered mailbox views can apply Gmail history updates. Filtered search and Drafts refresh manually. Foreground polling remains the reliability fallback.

For Pro mailboxes:

1. Gmail sends an authenticated notification to the Cloudflare ingress.
2. The ingress validates the Google identity, notifies the mailbox Durable Object, and enqueues a mailbox job in Cloudflare Queues.
3. A Cloudflare queue consumer reconciles Gmail history through Hyperdrive and updates persisted state.
4. Focused browser tabs receive mailbox-dirty signals from the mailbox Durable Object and refresh immediately.
5. Scheduled maintenance on Cloudflare selects only mailboxes with due work: watch renewal (heartbeat plus expiry lookahead), first-time setup, or stale reconciliation for mailboxes with enabled automations.

The notification is a wake-up signal, not the source of truth.

## Managed Mail

SST owns standalone inbound and outbound mail infrastructure.

Inbound:

1. SES stores the raw message in S3.
2. SNS invokes the receipt processor.
3. The processor parses the MIME message and writes one row per exact managed recipient. Recipients that match no exact inbox fall through to the domain's whole-domain (catch-all) inbox when one is configured; one delivered message never produces duplicate rows for the same mailbox.
4. Untracked S3 objects are deleted.

Outbound:

- Managed compose and replies send through server-side mail logic.
- `POST /api/v1/send` authenticates an organization API key and requires a verified sender domain.
- Better Auth email hooks call the same endpoint.

## Chat

Chats are mailbox-scoped. There is no cross-request resumability: each POST carries one turn. A turn that fails leaves no assistant row behind; stopping or disconnecting mid-stream persists whatever was already generated.

1. The AI SDK `useChat` hook posts to `POST /api/chat`, sending the mailbox context, selected model, and only the newest client message.
2. The server authorizes the mailbox-scoped thread, persists the user message, and rebuilds the canonical transcript from PostgreSQL; client-sent history is never trusted.
3. The AI SDK runs the model with Gmail, memory, Linear, calendar, and compose tools and streams its UI message protocol directly to the browser.
4. Tools that change state (`modify_mail`, `memory`, `linear_write`, `create_google_calendar_event`) require explicit user approval through the AI SDK's tool approval flow; a turn that ends on an approval prompt is persisted with its pending parts, so the decision can be validated server-side against what is actually pending.
5. `compose_email` is resolved entirely in the browser: the model proposes a draft, the user edits it in an inline composer, and the chosen Send/Save-draft/Decline outcome flows back as a client tool result.
6. Cancelling before any content arrived leaves no row. Once content has streamed, stopping the answer or disconnecting persists the partial assistant row when the stream ends, so reloads show what was generated. Failed generations persist nothing; their truncated output is indistinguishable from a broken answer.
7. Successful completion also refreshes billing usage and the chat title in the background. There is no streaming status column, generation lock, or cross-device polling: the composer disables itself locally while a request is in flight.

## Consent and Observability

c15t runs in offline mode. Consent preferences stay in the browser and do not require an API route, database tables, or migrations.

- PostHog and Speed Insights load only after `measurement` consent.
- Client Sentry remains enabled in production and is disclosed in the privacy policy.
- Server-side unexpected failures from the web worker, all Cloudflare background workers, and AWS functions are reported to Sentry; expected user and authorization states are filtered before capture.
- Signup acceptance of Terms and Privacy is separate from analytics consent.

## Billing

Billing subscriptions belong to teams. Paid plans are `managed` and `pro`. A subscription grants access only while active or trialing and before its current period ends.

Polar handles checkout, renewals, and subscription events. Signed webhooks synchronize subscription status, period dates, and scheduled cancellation. Billing reads reconcile stale records after five minutes, including active and past-due subscriptions, to recover from missed events. Equal provider timestamps can refresh the reconciliation time; older timestamps cannot overwrite newer subscription state. A failed reconciliation returns an unavailable state and retries after five minutes. Checkout refreshes the existing subscription before deciding whether a new checkout is allowed, preventing duplicate subscriptions after a missed renewal.

Canceling at period end preserves access until the period ends. Immediate cancellation, expiry, or past-due status pauses sending, API access, and paid configuration changes. Domains, keys, inboxes, and existing messages are retained. Billing management and authorized deletion remain available. Incoming mail continues for configured inboxes; cancellation does not delete receipt rules or silently discard accepted messages. Full inbound suspension, sender rejection, and a retention deadline are not implemented. Receiving and storage can therefore still incur costs after cancellation.

The additive `cancelAtPeriodEnd` migration must run through the protected migration workflow before deploying code that reads the column. It defaults to false for existing records and is refreshed from Polar on the next reconciliation. No production migration is run from a local checkout.

For private production testing, a 100% subscription discount must cover every intended billing cycle. Check its duration and the discount attached to the affected subscription in Polar. Merchant verification and subscription status are separate; do not bypass production billing checks based on an unverified merchant account. An active subscription with a past period end stays paused until the provider advances the period. Extending access against the old period would also omit new usage from its credit window. See [billing operations](./billing.md) for production setup and renewal troubleshooting. Organization mail usage is measured separately and billed according to plan-specific markup.

## Infrastructure Ownership

SST provisions both providers. AWS owns the SES receipt bucket, receipt topic and role, and mail-processing functions. Cloudflare owns Gmail notification ingress, queueing, scheduled maintenance, and live-sync Durable Objects.

Cloudflare Workers hosts the web application. SST builds and publishes production and binds deployment outputs directly.

### SST configuration layout

The root [`sst.config.ts`](../sst.config.ts) owns only app-wide SST settings and delegates resource composition to [`infra/`](../infra):

- `stage.ts` centralizes stage flags, domains, and deployment environment names.
- `runtime.ts` normalizes `@quieter/env` values and shared Worker/function environment groups.
- `secrets.ts` declares stage-aware `sst.Secret` resources and Cloudflare secret bindings.
- `database.ts` owns the Cloudflare Hyperdrive binding.
- `web.ts` owns the TanStack Start Worker and its common bindings.
- Mailbox actions execute asynchronously from their persisted runs: Gmail sync and maintenance dispatch new runs straight onto Cloudflare Queues, while a per-minute fallback cron atomically claims SES-ingested, lost, or crashed runs before dispatching them. Transient execution failures stay retryable until the queue's final delivery settles the run as failed.
- `mail.ts` owns SES receipt storage, processing, ingress, and send permissions.
- `gmail.ts` owns Gmail live-sync and Pub/Sub resources on Cloudflare.
- `app.ts` is the small stage-aware composition entry point; `types.ts` contains shared infra boundary types.

SST is the runtime source of truth for application credentials and tokens; their canonical names live in `packages/env/src/sst-secrets.ts`. Cloudflare receives them as secret-text bindings, while AWS functions receive values derived from SST secret outputs. Deployment environment variables are reserved for non-secret configuration such as feature switches, resource identifiers, domains, and provider deployment credentials.
