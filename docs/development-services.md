# Development service audit

Researched and exercised on September 5, 2026. This is a coverage ledger, not a claim that every feature has passed end-to-end acceptance. Secrets and private mail are excluded. See [startup and debugging](development.md) and [ownership rules](development-integrations.md).

Agent connector readiness is tracked separately in [Agent tooling](agent-tooling.md). The original runtime audit omitted verification of Sentry MCP and other agent access. Passing application tests or disabling local telemetry does not establish that debugging tools are ready.

## Verified setup

| Area | Current evidence | Remaining proof |
| --- | --- | --- |
| Database | Existing shared-cluster quieter_dev, separate app/migrator roles, verified TLS, 59 migrations, pgvector 0.8.5, backup before migration | Destructive migration tests run in disposable CI, not against this database |
| Identity | Real localhost Google sign-in succeeds after adding its missing callback | Magic-link, passkey/device and full role lifecycle acceptance |
| Gmail | Separate OAuth client and Pub/Sub pull subscription; observation guards; fresh consent; real inbox loads 18 conversations | Test-account passkey consent, provider writes and delivered-notification processing |
| Cloudflare | Native web/Worker runtime; signed WebSocket smoke; native queue/DO tests; authenticated manual maintenance/dispatch | Deployed concurrency, hibernation, IAM and cloud pooling |
| Secrets | 22 development SST secrets in local-leander; 21 runtime links; fresh-checkout pull verified; SST starts web and background runtimes together | Isolated AWS managed-mail stage |
| OpenRouter | Separate $1-capped development key; API smoke cost $0.000002; actual app chat streamed the expected response and saved its conversation | Voice, tool use and automation quality tests |
| Workers AI | Separate AI-only token; real 1024-dimension embedding | Application memory write/search/delete lifecycle |
| Polar | Non-expiring sandbox token, existing Managed/Pro products, official CLI 1.3.9 in WSL; six real customer/member events returned HTTP 200 | Checkout/portal/renewal/cancellation/credits with bypass off |
| Telemetry | Explicit opt-in implemented; off by default; consent still required for PostHog | Development-project ingestion and browser privacy assertions |
| Managed mail | Provider paths and isolation requirements audited | Private development R2, SST Live resources, test domain and SES simulator/MX acceptance |
| Calendar/Linear | Independent server-side write controls; Calendar verifies the actual primary calendar account; OAuth configuration present | Real connector authorization and dedicated resources for writes |
| logo.dev/c15t | Real publishable logo configuration; consent uses offline mode | Focused UI/network acceptance |
| Domain Connect | Inactive | Deferred until activated |

Checks: 693 tests passed, 16 disposable-database tests skipped; 31 native Cloudflare tests passed; lint/types, database migration checks and all AWS/Cloudflare handler bundles passed. Skipped and provider-specific acceptance remains explicit below.

The existing sandbox also contains webhook endpoints for older deployments. Local billing now namespaces customer/member IDs and stamps subscription metadata; local subscription handlers ignore other environments. Production gains the reciprocal guard only when this change is deployed. Do not copy production billing rows into development or reuse an existing deployment's sandbox customers for tests.

Two old development migration hashes differ from current files. Forward migrations completed without rewriting history. The backup is an ignored local artifact containing private development data, and must not be committed. The temporary admin credential used to install pgvector was deleted immediately afterward.

## Provider-native development systems

The following research describes supported tools and their limits. Where a paragraph recommends further work, the verified-setup table above is the authority on what has actually been exercised.

### SST

SST's `dev` command manages a personal stage, watches infrastructure, starts frontend commands, and makes resource links available locally. Its TanStack Start component explicitly starts the app in development mode. The frontend should be started through this mechanism when it needs SST links. Running an unrelated Vite process next to SST does not establish the same environment. See [SST linking](https://sst.dev/docs/linking/) and [TanStack Start development options](https://sst.dev/docs/component/cloudflare/tan-stack-start/).

For AWS Lambda, SST Live proxies real AWS invocations to local code and supports breakpoints. S3, SNS, SES, IAM, and other supporting cloud resources remain real. Stopping the terminal does not remove those resources. This is the preferred cloud-connected mail development path for this repository. See [SST Live](https://sst.dev/docs/live/).

The installed SST Cloudflare Worker component registers development runtime targets. Its public documentation does not establish complete local equivalence for all queue, cron, and Durable Object behavior. Use Cloudflare's documented multi-Worker local mode for deterministic tests and verify SST's integration behavior on the isolated stage. Do not infer that Lambda Live's exact mechanism applies to every Worker trigger.

Implemented: `sst.local.config.ts` uses a personal stage and native [DevCommand](https://sst.dev/docs/component/experimental/dev-command/) with Secret links. `vp run dev:sst --stage local-leander` refreshes 21 runtime secrets, then starts Vite and Wrangler together. The migration credential remains outside the runtime links. Fresh template bootstrap, linked-secret loading, browser settings and Worker health have passed. The production frontend's command is explicitly Vite+. Native Windows support is documented as beta; WSL remains useful for Polar, whose CLI has no native Windows release. See [SST CLI](https://sst.dev/docs/reference/cli/).

### Cloudflare Workers, Queues, Durable Objects, scheduled jobs, and Hyperdrive

Cloudflare's Vite plugin runs Worker code in workerd. `auxiliaryWorkers` runs the other application Workers in the same development session. This is the native fit for the realtime ingress, Gmail queue consumer, Gmail maintenance scheduler, mailbox-action consumer, and action dispatcher. Service bindings connect entrypoints. See [multiple Workers](https://developers.cloudflare.com/workers/local-development/multi-workers/).

Queues have native local producers and consumers. They support testing message flow without a cloud queue, but local consumer concurrency is not supported, and Wrangler remote mode does not support Queues. Test distributed concurrency and delivery behavior in the deployed development stage. See [Queues local development](https://developers.cloudflare.com/queues/configuration/local-development/).

Durable Objects run locally with persistent state. Test authenticated WebSocket upgrades, broadcasts, reconnects, and per-mailbox isolation locally. Validate hibernation, rollout behavior, and geographically distributed operation in the deployed stage. Scheduled handlers can be invoked with Cloudflare's scheduled-event testing facility rather than waiting for real time. See [local bindings](https://developers.cloudflare.com/workers/local-development/bindings-per-env/) and [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

Local Hyperdrive uses a local connection string to connect directly to PostgreSQL. It does not reproduce cloud pooling and query caching. Quieter disables Hyperdrive caching in infrastructure, but connection lifecycle and pooling still need a deployed check. See [Hyperdrive local development](https://developers.cloudflare.com/hyperdrive/configuration/local-development/).

Local Explorer is already installed and working. It exposes local resource inspection and observability, including traces and events. It can inspect SQLite Durable Objects and R2 objects once bindings exist. It is not a PostgreSQL browser. Use its existing UI and supported API for debugging. See [Local Explorer](https://developers.cloudflare.com/workers/local-development/local-explorer/).

The Vite plugin also has built-in tunnel support, including named tunnels. A stable HTTPS address is useful for OAuth callbacks and signed webhooks. Expose only the application endpoints required for integration tests; local inspection tools and preview authentication must remain protected. See [development tunnels](https://developers.cloudflare.com/workers/local-development/local-dev-tunnels/).

### Cloudflare R2 and Workers AI

R2 has native local simulation through Worker bindings, plus optional remote bindings to a real bucket. However, Quieter reads and writes raw mail using the S3 HTTP API. Those requests do not become local merely because a local R2 binding exists. See [R2 Worker API development](https://developers.cloudflare.com/r2/get-started/workers-api/).

For immediate provider-connected testing, use a dedicated private development R2 bucket with scoped credentials, shared by the local app and SST mail handlers. For deterministic offline tests, add a provider-neutral storage boundary that can use native local R2 for Workers and an appropriate test implementation for Lambda. A local S3-compatible service is another option, but requires explicit SDK endpoint configuration. Public `r2.dev` access is unsuitable for private mail.

Workers AI executes models remotely even during local development. Quieter calls its REST API for the 1024-dimensional `@cf/qwen/qwen3-embedding-0.6b` model and stores embeddings in PostgreSQL. Local binding configuration alone will not intercept those REST calls. Supply a restricted development AI token for real embedding checks and deterministic embedding fixtures for offline tests. Vectorize is not required by the current implementation. See [Cloudflare local development](https://developers.cloudflare.com/workers/local-development/).

### PlanetScale, PostgreSQL, pgvector, and Drizzle

PlanetScale officially supports ordinary local PostgreSQL for development and separate PostgreSQL branches for cloud testing. A PlanetScale branch is an isolated deployment. The observed account has only the production `main` branch; `quieter_dev` is a separate logical database on that cluster. It shares cluster resources with production. See [development environments](https://planetscale.com/docs/postgres/development-environments) and [PostgreSQL branching](https://planetscale.com/docs/postgres/branching).

Use the existing allowlisted `quieter_dev` logical database for normal development. No additional paid PlanetScale branch/cluster or persistent local PostgreSQL is required. Keep destructive migration tests on disposable CI databases. The shared cluster is PostgreSQL 18.6, while the existing CI lane uses PostgreSQL 16; retain a version-compatibility check. See [official pgvector installation](https://github.com/pgvector/pgvector).

Drizzle already supplies migration tooling and a local Studio database browser. Add a guarded Vite+ script for Studio targeting only the chosen development DB. The existing repository migration wrappers should remain the authority for schema changes. See [Drizzle Studio](https://orm.drizzle.team/docs/drizzle-kit-studio).

### AWS SES, S3, SNS, Lambda, SQS, IAM, and CloudWatch

The provider-native end-to-end route is isolated AWS resources managed by SST, with Lambda Live for local debugging. SES offers a mailbox simulator for success, bounce, complaint, and other sending scenarios. These are real AWS calls and do not prove inbound MX routing. Use simulator recipients first, then dedicated test inboxes and a development mail domain. See [SES simulator](https://docs.aws.amazon.com/ses/latest/dg/send-an-email-from-console.html).

AWS SAM can invoke Lambda locally with fixture events and Docker. It is useful for a focused Lambda runtime test, but adopting a second infrastructure definition is unnecessary for normal SST development. S3/SNS/SQS event fixtures cover handler parsing; real cloud tests cover subscriptions, IAM, retries, dead-letter destinations, alarms, and SES receipt behavior. See [AWS SAM local testing](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-samcli-terraform.html).

LocalStack is a third-party alternative for offline AWS API emulation, including SES. It is optional, not an AWS requirement and not the default recommendation here. Validate the exact SESv2 operations and applicable license before adopting it. Mailpit is only a mail capture UI/SMTP service; it does not reproduce the SES API, SNS feedback, or IAM. See [LocalStack SES](https://docs.localstack.cloud/aws/services/ses/).

### Polar

Polar provides a separate sandbox with sandbox credentials, products, customers, subscriptions, checkout, and webhooks. Payments are simulated. Quieter already has the sandbox and products. Local credentials and product IDs are configured; native CLI webhook delivery has been verified. Use the provider's tools to inspect and replay deliveries. See [Polar sandbox](https://polar.sh/docs/integrate/sandbox).

Polar documents a local webhook forwarding CLI. Its documented installation targets macOS/Linux/WSL. On this machine use that supported path, or the Cloudflare development tunnel with the sandbox webhook endpoint. Confirm the CLI session is connected to the sandbox before forwarding. The application endpoint is `/api/auth/polar/webhooks`. See [local webhook forwarding](https://polar.sh/docs/integrate/webhooks/locally).

The sandbox's existing endpoints point to an older Vercel staging address and a production-domain legacy billing route. Neither is a verified current local webhook. The sandbox UI also restricts customer emails to organization members and their sub-address aliases.

Polar changes signing for newly generated secrets on September 8, 2026. Current Quieter code already verifies both Standard Webhooks and the legacy Polar scheme, with tests for both. This is a compatibility requirement already addressed in code, not a newly discovered signature bug. Test actual sandbox delivery as part of setup. See [delivery and signature documentation](https://polar.sh/docs/integrate/webhooks/delivery).

Disable `QUIETER_LOCAL_BILLING_BYPASS` during billing acceptance tests. Checkout, cancellation, renewal, plan changes, credits, usage reconciliation, failures, and duplicate/out-of-order webhook deliveries must affect real development entitlements.

### Google identity, Gmail, Calendar, and Pub/Sub

Google supports development OAuth clients, localhost redirects, testing consent audiences, and test users. Identity OAuth must remain separate from Gmail authorization. The development Gmail client is separate. Identity login currently uses the existing staging identity client, with localhost added to its allowed origins and callback URLs. Still use dedicated test Google accounts, because a development OAuth client can access a real personal inbox after consent. External apps in Testing generally receive seven-day refresh tokens for Gmail/Calendar scopes. See [Google OAuth](https://developers.google.com/identity/protocols/oauth2).

Gmail's official integration path uses real test mailboxes. I found no official complete local Gmail API emulator. Test fixtures cover deterministic API responses and failures; a real mailbox covers consent, refresh, send, labels, drafts, history, and watch behavior. Gmail pushes to real Pub/Sub, and watches require renewal. See [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push).

Google Pub/Sub does have an official local emulator. It supports local message testing and HTTP push, but does not implement IAM or turn Gmail into a local service. It cannot prove Google's real OIDC push authentication. Use it only where its API behavior adds coverage; use signed fixtures for the ingress verifier and a real development subscription for end-to-end delivery. See [Pub/Sub emulator](https://docs.cloud.google.com/pubsub/docs/emulator?hl=en).

Calendar's official local quickstart connects local code to real Google Calendar. I found no complete official local Calendar emulator. Quieter currently targets the primary calendar, so use a dedicated test account rather than assuming a spare secondary calendar is enough isolation. Cover timezones, DST, all-day events, permissions, and cancellation. See [Calendar quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs).

### Linear

Linear supports OAuth with localhost redirects and provides its real API/MCP server. I found no complete official local service emulator or Polar-style payment sandbox. Use a dedicated test workspace and OAuth app, with transport fixtures for deterministic tests. Quieter's local Linear client ID and secret currently match production. Separate these before automated issue creation/update tests. Exercise refresh, revocation, permission changes, and rotating refresh-token persistence. See [Linear OAuth](https://linear.app/developers/oauth-2-0-authentication).

### OpenRouter and the AI SDK

OpenRouter is a hosted API. Use a development key with a spending limit for real model behavior. The existing local key is different from production and had approximately $0.998 remaining under a $1 limit when inspected. That is enough for a small probe, not an unrestricted regression suite. No budget was changed. See [OpenRouter key management](https://openrouter.ai/docs/guides/overview/auth/management-api-keys).

The installed AI SDK already exports `MockLanguageModelV4`, embedding/transcription mocks, and stream simulation helpers. Use these native library tools for reproducible tool calls, streaming, cancellation, malformed output, provider errors, and credit calculations. Quieter has a custom OpenRouter transcription HTTP path, so test its request/response adapter too. A separate OpenAI key is not required by the current provider path. See the installed `ai/test` exports and [AI SDK testing](https://ai-sdk.dev/docs/ai-sdk-core/testing).

### Better Auth

Better Auth runs in the application and has no separate hosted auth environment to provision. Its installed version exports `testUtils`, providing factories and authenticated test-session helpers. Keep that configuration test-only. Existing preview personas help UI exploration but are not a complete provider/account fixture system. Test real magic-link consumption and OAuth callbacks in addition to injected test sessions. Use virtual authenticators for automated passkey tests plus a real device smoke test. See [Better Auth test utilities](https://better-auth.com/docs/plugins/test-utils).

### Sentry, PostHog, c15t, logo.dev, and Domain Connect

Sentry can receive events from local code in a separate development project/environment; official self-hosting also exists. Quieter explicitly disables key Sentry initialization paths during development, so adding a DSN will not be enough. The implementation now supplies explicit development-reporting opt-in; it remains off by default. Validate uploaded source maps with a production build in non-production. A whole local Sentry deployment is optional. See [Sentry self-hosting](https://github.com/getsentry/self-hosted).

PostHog's browser SDK supports local debugging and capture controls. Use a separate development project for real ingestion and network assertions for consent/privacy tests. A full local analytics backend is unnecessary to debug this application. See [PostHog configuration](https://posthog.com/docs/libraries/js/config).

c15t already runs in offline mode in Quieter. Its official offline mode stores consent locally, so no additional consent service is needed. Test acceptance, rejection, revocation, persistence, and absence of analytics calls before measurement consent. See [c15t React setup](https://c15t.com/docs/frameworks/react/quickstart).

logo.dev remains an external image API. The local publishable key exists. Use stable image fixtures and fallback tests for deterministic UI work; verify actual lookup with the development configuration. Its attribution rules distinguish local/staging environments, but that does not imply unlimited usage. See [logo.dev attribution](https://www.logo.dev/docs/platform/attribution).

Domain Connect supplies a protocol, example service, templates, and signing examples rather than a complete local DNS-provider emulator. Test signing and callbacks locally; use a dedicated domain for actual registrar/DNS changes and SES verification. The required private signing key is consumed by code but omitted from the current SST secret registry and deployment bindings. See [Domain Connect getting started](https://www.domainconnect.org/getting-started/).

GitHub Actions provides the existing CI execution environment. GitHub CLI authentication works. There is no need to run GitHub itself locally. Vercel is present in older sandbox webhook destinations, but the current app infrastructure targets Cloudflare. D1, KV, Vectorize, Cloudflare Workflows, Redis, and Neon are not prerequisites inferred from the current runtime inventory. Quieter mailbox workflows use its own database/queue execution model.

## Feature acceptance matrix

These are required acceptance cases, not a claim that every row was executed during the audit. Each row needs a named fixture, an automated check where practical, and evidence for the real-provider lane.

| Feature group | Local tests | Connected or deployed proof |
| --- | --- | --- |
| Sign-in and onboarding | Magic-link expiry/reuse, session/logout, terms, redirects, preview isolation | Google consent and real link delivery |
| Passkeys | Virtual authenticator register/login/remove, failed challenge | Real device/browser smoke test |
| Organizations and divisions | Owner/admin/member roles, invites, cross-org denials | Invitation delivery and membership lifecycle |
| Mailbox ownership and grants | Two users, private Gmail, private managed mailbox, explicit grants/revocation | Provider account ownership remains separate |
| Mail browsing | Thread grouping, unread counts, archive/trash/spam, pagination, empty/loading/error states | Gmail history and real managed-message ingestion |
| Search and saved views | Mailbox-scoped queries, filters, saved searches, cache invalidation | Gmail search semantics and indexed DB behavior |
| Compose | Draft persistence, reply/all/forward, recipients, templates, attachments, retries | Real Gmail send and SES simulator send |
| Message rendering | MIME variants, HTML sanitization, inline images, downloads, malformed content | Large real fixture messages and private object permissions |
| Labels and organization | CRUD, batch operations, optimistic rollback | Gmail label changes and reconciliation |
| Realtime | Signed socket auth, reconnect, broadcasts, wrong-mailbox denials | Google push, deployed DO lifecycle and WSS |
| Gmail maintenance | Watch expiry, missing history, retry/backoff, stale leases | Real watch renewal, OAuth expiry, subscription authentication |
| Automation editor | Graph validation, save/publish, conditions, invalid connectors | Executed published workflow with real test connectors |
| Automation execution | Queue delivery, retries, duplicate events, crash recovery, run status | Deployed consumer concurrency, DLQ and scheduling |
| AI chat | Stream/tool calls, cancellation, persistence, credit errors, malformed output | Capped real OpenRouter model calls |
| Voice input | Permission/error UI, format and size validation, transcription fixtures | Actual microphone and OpenRouter transcription |
| AI memory | Personal/mailbox ownership, lexical/semantic retrieval, deletion | pgvector index and real embedding dimensions |
| Automatic AI features | Label/detail extraction and action conditions with fixed outputs | Selected real-model quality regression examples |
| Calendar connector | OAuth state, credential encryption, events, UTC/DST/all-day cases | Dedicated primary calendar read/write/revoke |
| Linear connector | MCP/tool schemas, auth expiry, retries, permission errors | Dedicated workspace read/write/revoke |
| Billing | Webhook signatures, ordering/idempotency, entitlements, credits, usage | Polar sandbox checkout, plan changes, cancellation and renewal |
| Managed domains | DNS record generation, verification states, catch-all routing | Test-domain MX/SPF/DKIM, SES identities and Domain Connect |
| Inbound managed mail | Raw MIME fixtures, recipient routing, deduplication, rollback | SES to S3/SNS/Lambda to private R2 and development DB |
| Outbound mail and feedback | API validation, idempotency, authorization, delivery projection | SES success/bounce/complaint, suppressions, failure destination |
| Public API and SDK | API key scope/revoke, OpenAPI contracts, limits, credit failures | SDK request against isolated running app |
| Privacy and monitoring | No pre-consent capture, no PII/content payloads, error filtering | Development Sentry/PostHog ingestion and source maps |
| UI resilience | Mobile layouts, keyboard use, focus, stale cache, disconnect/reconnect | Multiple browsers, real device and constrained network |
| Recovery and deployment | Clean seed/reset, migration replay, old/new schema compatibility | Deployment rollback, IAM restrictions, cloud logs and DLQ |
