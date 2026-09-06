# Cloudflare-first mail platform reliability and deployment plan

## Status

- Approved implementation direction. Delivery remains phased; this document does not imply that later milestones have shipped.
- Target availability: 99.999% for the transactional Mail API.
- Data objective: RPO 0 for every submission acknowledged by Quieter.
- Primary platform: Cloudflare.
- AWS scope: SES and the minimum SES-adjacent storage, buffering, and IAM needed for reliable integration.
- Secret source: SST Secrets exclusively for application and operational secrets.
- Bootstrap exception: the Cloudflare deployment credential must remain outside the SST application because SST needs it before it can read or deploy the application. AWS uses GitHub OIDC, not stored access keys.

## Executive decision

Do not build a general deployment platform and do not attempt an atomic AWS, Cloudflare, and PostgreSQL deployment. Build a small release controller around provider-native immutable versions and traffic promotion. Organize the runtime as a modular monorepo with a deliberate set of independently deployable Cloudflare Workers.

Separate the system into two planes:

- The mail data plane accepts, queues, sends, receives, and reports mail. It must continue operating when the dashboard or control plane is unavailable.
- The control plane manages users, domains, billing configuration, mailboxes, and the dashboard. Its releases must not deploy or restart the mail data plane.

SST remains the infrastructure and secret-definition tool. Routine Worker releases eventually use Cloudflare Versions and Deployments so code can be uploaded, tested, promoted, and rolled back without reconciling infrastructure. One deployable must never be rebuilt or promoted merely because an unrelated deployable changed.

The implementation must first make acknowledged submissions durable. Fast rollback is useful only after in-flight work is independent of the runtime version processing it.

## Program execution strategy

This is a large, deep refactor of persistence semantics, runtime boundaries, queue topology, deployment ownership, and operational practices. Treat it as a sequence of production migrations, not a rewrite.

### No big-bang cutover

- Do not build the target platform on a long-lived branch and switch everything at once.
- Do not combine durable acceptance, asynchronous sending, Worker extraction, SST state movement, and native Cloudflare promotion in one release.
- Keep the current production path available until the replacement path has passed shadow traffic, synthetic traffic, an internal cohort, and a limited production cohort.
- Give every phase an explicit entry condition, production observation period, rollback procedure, and old-path removal condition.
- Stop after any phase if reliability metrics regress. Later phases must not be required to make the current phase safe.

### Migration pattern

Use the same pattern for code, data, queues, and infrastructure:

1. Expand: add new tables, fields, queues, bindings, Workers, and compatible code without removing the old path.
2. Mirror or shadow: exercise the new path without creating external side effects, and compare decisions and payload checksums.
3. Cohort: route synthetic, internal, then selected production traffic to the new path.
4. Cut over: make the new path authoritative while retaining the old path as a disabled rollback option.
5. Observe: keep both schemas and contracts through a defined bake period.
6. Contract: remove obsolete code, fields, queues, bindings, and compatibility only in later reviewed releases.

Never run old and new outbound senders in a mode where both can call SES for the same submission. Shadow sending ends before provider side effects and compares canonical payload hashes instead.

### Workstream dependencies

Run research, tests, and non-production groundwork in parallel, but preserve this production dependency order:

```text
release visibility and manual rollback
  -> durable submission ledger
  -> transactional outbox
  -> Cloudflare sender queue
  -> dedicated Mail API
  -> control API and frontend split
  -> inbound, feedback, webhook, and automation deployables
  -> SST state separation
  -> inactive version upload and automatic rollback
  -> secondary SES region preparedness
```

Inbound buffering, observability, and contract-test work may proceed alongside outbound work when they do not modify the same production resources.

### Change management

- Track the program as one parent initiative with one scoped issue per pull request or migration step.
- Record architecture decisions for the acceptance boundary, event envelopes, service ownership, control API compatibility policy, SST state boundaries, and Worker promotion mechanism.
- Keep pull requests reviewable and independently deployable. Prefer one schema expansion, one runtime addition, or one traffic change per pull request.
- Avoid long-lived feature branches. Merge dormant additive code behind server-controlled rollout state.
- Keep rollout controls provider-neutral and server-side. A stale frontend must not decide whether a submission uses the old or new sender path.
- Use explicit production cohort records or configuration with audit history. Do not use PostHog analytics flags for correctness-critical routing.
- Assign an owner and reviewer for every data migration, infrastructure move, queue contract, and production cutover.
- Schedule destructive cleanup only after the observation evidence is attached to its pull request.

### Per-phase evidence package

Before each production cutover, attach:

- architecture and data-flow diff.
- affected deployables and resources.
- migration and compatibility analysis.
- test results and synthetic evidence.
- expected metrics and alert thresholds.
- rollback steps and the last safe rollback point.
- data reconciliation query or command.
- privacy and security review notes.
- operator and reviewer names.

After cutover, record actual error rate, latency, queue lag, duplicate count, reconciliation count, rollback timing if exercised, and whether old-path removal is approved.

### Definition of a safe checkpoint

Every phase must leave production in a state where:

- all acknowledged submissions remain recoverable.
- one authoritative path owns each external side effect.
- old and new schemas are mutually compatible with the deployed runtimes.
- queue messages remain processable by at least one retained runtime version.
- an operator can identify current ownership and replay or rollback behavior.
- the next phase may be delayed indefinitely without creating hidden expiry or cleanup risk.

## Service contract

### Public send API

Keep the familiar provider API behavior:

- Return HTTP 201 for a newly accepted submission and HTTP 200 for an idempotent replay.
- Return a stable Quieter message ID after Quieter durably commits the submission.
- Do not wait for SES before returning success.
- Expose the current state separately: `queued`, `sending`, `sent`, `delivered`, `delayed`, `failed`, `bounced`, or `complained`.
- Publish status changes through signed customer webhooks.
- Treat `sent` as accepted by SES, not delivered to the recipient server.

The HTTP status is not the durability boundary. The PostgreSQL commit containing the submission, idempotency result, usage reservation, and outbox row is the durability boundary.

### Delivery semantics

- Guarantee RPO 0 for submissions for which Quieter returned success.
- Use at-least-once processing internally.
- Make every queue consumer and state transition idempotent.
- Return the same message ID and response for retries with the same idempotency key and payload.
- Reject reuse of an idempotency key with a different payload.
- Document that exactly-once external delivery cannot be guaranteed because SES has no caller-supplied idempotency token and an ambiguous network timeout can occur after SES accepted a request.
- Minimize provider duplicates with deterministic Quieter IDs, stable RFC Message-ID values, leases, attempt records, and conservative retry classification.

### Availability objectives

Define these as separate SLOs rather than one blended uptime number:

- Mail API availability: 99.999% measured at the public edge.
- Accepted-submission durability: no acknowledged submission may disappear.
- Mail API latency: establish p50, p95, and p99 targets after measuring the durable acceptance transaction.
- Outbox lag: establish a normal target and page before customer-facing delay becomes material.
- SES submission lag: measure time from Quieter acceptance to SES acceptance.
- Webhook lag: measure time from internal event commit to successful customer delivery.
- Inbound ingestion lag: measure time from SES receipt to durable Quieter mailbox state.

Do not publish a contractual five-nines SLA until Cloudflare, PlanetScale, and AWS service contracts, support plans, and measured behavior support it.

## Current risks to remove

### Deployment

- `.github/workflows/sst-deploy.yml` mutates four SST secrets during every release.
- Production migrations run before a single cross-provider `sst deploy`.
- CI builds a web artifact, but deployment builds it again instead of promoting the tested artifact.
- One SST operation updates AWS infrastructure, AWS runtime code, Cloudflare infrastructure, and Worker code.
- No release manifest records the previous and candidate provider versions.
- No production smoke test, bake period, gradual promotion, or automated rollback exists.
- The documented rollback redeploys an old repository revision through SST. That is infrastructure reconciliation, not immediate code rollback.
- Non-secret deployment configuration is spread across GitHub environment variables and `process.env` reads.

### Outbound mail

- `packages/orpc/src/organization-mail.ts` holds an organization usage lock while building MIME, checking policy, calling SES, and persisting post-send state.
- `/api/v1/send` calls SES synchronously and has no durable outbound queue.
- Idempotency is optional.
- A crash can leave a pending idempotency row blocked for seven days.
- SES can accept a message before Quieter persists its final response.
- Message and usage persistence after SES are best-effort, so feedback can become unresolvable.
- The public transactional API is deployed with the dashboard Worker.
- Authentication mail calls the public API on the same origin, creating a same-service dependency.

### Inbound and background processing

- SES inbound notifications invoke Lambda through SNS without an explicit SQS buffer and DLQ.
- Raw S3 landing objects expire after one day.
- Production ingestion synchronously copies S3 content to R2 before it can finish.
- Receipt-rule resources are changed imperatively by application code rather than managed as stable infrastructure.
- Mailbox-action rows can commit before SQS enqueue, and enqueue errors are swallowed.
- Failed mailbox-action runs become unclaimable on SQS retry, weakening DLQ behavior.
- Cloudflare Gmail processing synchronously depends on an AWS Function URL and a shared secret even though much of the path already runs on Cloudflare.

## Target architecture

```text
Customer
  -> Cloudflare Mail API Worker
  -> PlanetScale Postgres through Hyperdrive
       mail submission
       idempotency result
       usage reservation
       transactional outbox
  -> stable Quieter message ID

Outbox publisher
  -> Cloudflare outbound queue
  -> Cloudflare sender consumer
  -> AWS SES HTTPS API
  -> submission state

AWS SES feedback
  -> SNS
  -> SQS safety buffer
  -> minimal bridge or Cloudflare pull processor
  -> Cloudflare feedback queue
  -> Cloudflare feedback consumer
  -> delivery state and customer webhook outbox

Inbound SES
  -> S3 durable landing object
  -> SNS
  -> SQS safety buffer
  -> minimal bridge or Cloudflare pull processor
  -> R2 canonical copy
  -> Cloudflare inbound queue
  -> Cloudflare inbound consumer
  -> Postgres mailbox state

Customer webhook outbox
  -> Cloudflare webhook queue
  -> Cloudflare webhook consumer
  -> customer endpoint
```

### Cloudflare responsibilities

- Dedicated public Mail API Worker.
- Dashboard/control-plane Worker deployed independently.
- Hyperdrive database connectivity.
- Outbound send queue and DLQ.
- SES sender consumer using the existing SST AWS permission-link pattern.
- Inbound processing after the AWS durability boundary.
- Feedback processing after the AWS durability boundary.
- Customer webhook dispatch and retries.
- Scheduled outbox, lease, and reconciliation work.
- R2 attachment and MIME storage after AWS initial receipt.
- Gmail realtime and queue processing where provider constraints permit.
- Worker logs, traces, version metadata, and release-specific metrics.

### AWS responsibilities

- SES identities, configuration sets, send operations, and receipt rules.
- S3 initial inbound MIME landing.
- SNS event destinations.
- SQS buffers and DLQs adjacent to SES so a Cloudflare outage cannot lose SES-originated work.
- IAM credentials and permissions used by Cloudflare Workers.
- Temporary bridge Lambdas only where AWS cannot push safely to Cloudflare or Cloudflare cannot consume the AWS buffer directly.

AWS bridge code must contain no billing, mailbox, policy, parsing, or workflow business logic. It validates an AWS event, preserves its stable event ID, forwards it, and retries safely.

### PlanetScale responsibilities

- Authoritative submission and idempotency ledger.
- Transactional outboxes.
- Usage reservations and final usage events.
- Delivery and recipient state.
- Webhook endpoint configuration and delivery records.
- Processing leases and reconciliation cursors.

PlanetScale production must use the normal three-availability-zone cluster, not a single-node branch. Every request-path transaction must tolerate a brief failover with bounded retries and a strict overall request deadline.

## Deployable topology

Use separate deployables where availability, rollback, scaling, permissions, queue pressure, or release cadence differ. Do not split business concepts into network services merely to call the architecture microservices.

| Deployable | Responsibility | Availability and release boundary |
| --- | --- | --- |
| `mail-api` | Public `/api/v1` submission and message-status API | Highest SLO; no UI, Gmail, automation, or webhook deployment may change its version |
| `mail-sender` | Outbound queue consumption and SES submission | Independent rollback; SES permission only; backlog must survive a bad release |
| `mail-inbound` | R2 ingestion, MIME parsing, and managed-mail persistence after AWS capture | Independent queue, DLQ, capacity, and rollback |
| `mail-events` | SES send, delivery, delay, bounce, complaint, reject, and suppression processing | Independent from sender and inbound processing |
| `mail-webhooks` | Signed customer webhook delivery, retries, and replay | Customer endpoint failures cannot consume sender capacity |
| `mail-automation` | Mailbox rules, connector effects, and AI actions | Lower-priority workload isolated from all mail transport paths |
| `control-api` | Authenticated oRPC application API for dashboard and settings | Backend deploys independently while retaining compatibility with deployed and recently opened frontends |
| `control-plane-web` | TanStack Start UI, SSR where needed, and static assets | Frontend failures cannot affect mail acceptance or processing |
| `gmail` | Gmail Pub/Sub ingress, sync, maintenance, and realtime behavior | Separate provider path and Durable Object lifecycle |
| `aws-inbound-bridge` | Validated AWS inbound event handoff to Cloudflare | Tiny adapter; no product business logic |
| `aws-feedback-bridge` | Validated SES feedback handoff to Cloudflare | Tiny adapter; independently retryable from inbound mail |

`mail-foundation` is an infrastructure boundary, not a runtime service. It owns stable queues, buckets, Hyperdrive, SES resources, IAM, routes, and bindings.

### Boundary rules

- Keep all deployables in this monorepo. Do not create separate repositories.
- Keep shared contracts and implementations in `packages/*`; deployable entrypoints remain thin.
- Never make `packages/*` depend on `apps/*`.
- UI code and app entrypoints continue using `@quieter/orpc`; they never access the database directly.
- Do not create a synchronous service chain in the Mail API acceptance path.
- `mail-api` may use Hyperdrive, R2, and its acceptance transaction. SES, webhooks, automation, Gmail, and the control plane stay outside that request.
- Use versioned queue events for asynchronous work.
- Use a direct internal service binding only when the caller can safely fail or degrade with the callee and a queue would violate the operation's semantics. Document every such exception.
- Give every deployable its own least-privilege bindings and SST Secret links. Do not link the full secret catalog by default.
- Give every queue workload its own queue and DLQ rather than attaching unrelated handlers to one consumer deployment.
- One deployable owns writes to each operational table family. Other deployables use its events or a narrow shared package contract rather than ad hoc writes.
- Keep one PlanetScale cluster and centralized migrations initially. Do not introduce database-per-service because the acceptance transaction must remain atomic.

### Proposed code layout

The final paths should follow repository conventions discovered during implementation. The intended shape is:

```text
apps/
  mail-api/                    dedicated public HTTP Worker
  web/                         control-plane UI and thin SSR/BFF only

packages/cloudflare/src/workers/
  mail-sender.ts
  mail-inbound.ts
  mail-events.ts
  mail-webhooks.ts
  mail-automation.ts
  control-api.ts
  gmail-realtime.ts

packages/mail/                 provider-neutral contracts and MIME behavior
packages/orpc/                 application services and control API routers
packages/database/             shared schema and migration authority
packages/deployment/           build, manifest, promotion, and rollback commands

infra/
  foundation.ts
  mail-api.ts
  mail-sender.ts
  mail-inbound.ts
  mail-events.ts
  mail-webhooks.ts
  mail-automation.ts
  control-api.ts
  web.ts
  gmail.ts
  aws-bridges.ts
```

Multiple handlers may remain in `@quieter/cloudflare`, but SST must create a distinct Worker resource and version history for every listed deployable. A shared package is not a shared deployment.

### When not to create a deployable

Keep a capability as a module when it has the same SLO, permissions, scaling profile, rollback decision, and release cadence as its caller. In particular, do not create separate synchronous organization, billing, domain, suppression, template, or attachment services. Those checks belong in the Mail API acceptance service so submission, idempotency, usage reservation, and outbox insertion remain one transaction.

## Frontend and backend skew protection

Splitting `control-api` from `control-plane-web` reduces blast radius but does not by itself make version skew safe. Old browser tabs continue calling the newest backend after a deployment. The API contract must explicitly support that overlap.

### Contract policy

- The public Mail API remains versioned under `/api/v1`; breaking changes require a new public API version and a published deprecation period.
- The internal control API supports the current frontend contract and the preceding supported frontend contract throughout a defined compatibility window.
- Define the compatibility window before extraction. It must cover at least the previous successful frontend release and the expected lifetime of an open browser tab.
- Backend changes are additive first. Add fields and procedures before a frontend uses them.
- Deploy the compatible backend before the frontend that consumes it.
- Remove old procedures or semantics only after client-version telemetry proves the compatibility window has elapsed.
- Do not repurpose an existing field or enum value with new semantics. Add a new field or value and migrate callers.
- Queue contracts use the same consumer-first, producer-second, delayed-removal rule.

### Runtime identification

- Include a non-sensitive frontend build ID on control API requests.
- Include backend release ID and contract version in response metadata suitable for diagnostics.
- Do not send user, mailbox, organization, message, or query identifiers with version telemetry.
- Return a typed upgrade-required response only when a client falls outside the documented compatibility window.
- Keep the existing stale-deployment recovery behavior for missing frontend chunks, but do not use page reloads as API compatibility handling.

### Contract verification

- Store serialized control API contract fixtures or generated client compatibility artifacts for every supported frontend version.
- Run the newest backend against current and preceding frontend contract tests in CI.
- Run the candidate frontend against the current production backend contract before promotion.
- Block removal of a procedure, required field, enum member, or behavior while a supported client fixture still depends on it.
- Add end-to-end tests that keep an old browser session open while deploying a new backend and then a new frontend.
- Track contract use by anonymous build ID and procedure name, not by user or private request data.

### Control API extraction constraints

- First inventory TanStack Start server routes, auth cookie behavior, oRPC transport, uploads, streaming, and same-origin assumptions.
- Choose either Cloudflare path routing or a stable thin BFF in `apps/web`; do not duplicate business logic in both Workers.
- If a thin BFF remains, it must be version-stable forwarding/authentication code with its own compatibility tests.
- Preserve CSRF, trusted-origin, session-cookie, and authorization behavior during extraction.
- Do not combine control API extraction with a Better Auth migration or public hostname migration.

## Data model plan

Implement schema changes through expand-only migrations. Exact names may be adjusted to match existing conventions, but the responsibilities must remain explicit.

### Mail submission

Add `organizationMailSubmission` with at least:

- Quieter-generated immutable `id` returned to the caller.
- `organizationId`.
- normalized sender and recipients.
- stable request hash.
- optional idempotency key, with a unique organization/key constraint when present.
- stable RFC Message-ID generated before queueing.
- current state and state timestamp.
- provider and nullable provider message ID.
- MIME or payload object reference and checksum.
- attachment totals and recipient count needed for usage calculation.
- attempt count and nullable next-attempt timestamp.
- lease owner and lease expiry for sender recovery.
- created, accepted, sent, and terminal timestamps.
- nullable sanitized failure category and customer-safe failure message.

Do not duplicate large attachment bodies in PostgreSQL. Store a canonical encrypted or access-controlled payload in R2 and commit its object reference and checksum. The API must upload the object before acknowledging the database transaction, and an orphan-object sweeper must remove uploads that never gain a committed submission.

For the first increment, retaining normalized body fields in Postgres may be acceptable if it avoids a risky object-storage migration. Attachments and final raw MIME should still move behind stable object references.

### Idempotency

Either replace `organizationMailSendIdempotency` with the submission uniqueness constraint or evolve it to reference the immutable submission ID.

Required behavior:

- Insert or retrieve the submission in the same transaction as acceptance.
- Store the successful API response immediately at acceptance, not after SES.
- A concurrent retry receives the accepted submission response once the first transaction commits.
- There is no seven-day `pending` state waiting for SES.
- Keep keys for at least the public documented retention period.
- Add a cleanup job that removes only terminal, expired records.
- SDKs generate idempotency keys automatically and preserve them across retries.

### Transactional outbox

Add a general or mail-specific outbox table containing:

- immutable event ID.
- event type and integer schema version.
- aggregate ID, normally the submission ID.
- serialized payload or payload reference.
- creation timestamp.
- publication lease owner and expiry.
- attempt count and next-attempt timestamp.
- published timestamp.
- last sanitized error category.

The acceptance transaction inserts the submission, usage reservation, idempotency result, and `mail.submission.accepted.v1` outbox event together.

The publisher claims rows with `FOR UPDATE SKIP LOCKED` or an equivalent atomic update, publishes to Cloudflare Queues, and marks them published. A crash after queue publication but before marking the row creates a duplicate queue message, which consumers must safely deduplicate by event ID.

### Send attempts

Add an attempt table keyed by submission and attempt number:

- attempt ID and idempotent consumer event ID.
- started and finished timestamps.
- provider region.
- result category.
- nullable SES message ID.
- sanitized provider response metadata.

Never store credentials or complete provider responses that may contain private content.

When SES times out ambiguously, record an `unknown` result. Do not blindly retry indefinitely. Define a conservative retry policy and surface the state operationally because SES does not support caller-provided idempotency.

### Customer webhooks

Add webhook endpoint, event, and delivery-attempt records if equivalent durable structures do not already exist.

- Sign payloads with a versioned per-organization secret.
- Give every event a stable event ID.
- Store payload schema version.
- Retry with bounded exponential backoff and jitter.
- Preserve failed deliveries beyond Cloudflare Queue's retention in PostgreSQL.
- Provide manual and automated replay.
- Treat 2xx as success and make redirects an explicit policy.
- Protect against SSRF, private networks, DNS rebinding, oversized responses, and long response times.

## Queue and event contracts

### General rules

- Every event includes `eventId`, `eventType`, `schemaVersion`, `aggregateId`, `occurredAt`, and a release-independent payload.
- Consumers deduplicate using a unique database key before applying side effects.
- Consumers understand the current and immediately preceding schema versions.
- Producers do not emit a new version until compatible consumers are fully deployed.
- Remove old-version support only after queue age and database queries prove the old version is drained.
- Configure a DLQ for every production queue.
- Configure explicit retries, retry delays, batch sizes, processing timeouts, and retention.
- Keep batches small until partial acknowledgement and idempotency are proven.
- Never log message content, recipient addresses, identifiers, or customer webhook URLs.

### Cloudflare queues

Create separate queues for:

- outbound mail submissions.
- inbound mail processing.
- SES feedback processing.
- customer webhook delivery.
- mailbox actions.

Do not combine unrelated workloads in one queue. Separate queues prevent a poison message or traffic spike from blocking another critical function.

Cloudflare Queues provide at-least-once delivery. Consumers must assume duplicates and out-of-order delivery. Database state transitions must reject stale events.

### AWS safety buffers

Keep SQS between SES-originated events and Cloudflare:

- one inbound receipt queue and DLQ.
- one outbound feedback queue and DLQ.
- 14-day SQS retention.
- S3 retention long enough to survive the full queue retention plus incident recovery.
- alarms for oldest message age, visible backlog, receive failures, and DLQ depth.

The Cloudflare handoff acknowledges the SQS message only after Cloudflare durably accepts it. If a bridge publishes to Cloudflare Queues, it must include the original stable AWS/SNS event ID so duplicate forwards are harmless.

## Secret and configuration plan

### SST Secrets

Add all application and operational secrets to `packages/env/src/sst-secrets.ts` and declare them through `infra/secrets.ts`.

At minimum, migrate these GitHub-held values into SST Secrets where applicable:

- production migration database URL.
- Sentry source-map upload token.
- Gmail rotation token if not already authoritative in SST.
- any customer webhook signing root material.
- bridge authentication credentials.

Update scripts to read linked resources through `Resource.<Name>.value`. Run operational scripts with `sst shell --stage production --target <resource> -- <command>` instead of copying secrets into GitHub workflow environment blocks.

Remove the `Configure production runtime secrets` deployment step. Secret setting and rotation must be explicit, separately authorized workflows or operator commands, not routine deployment work.

### Bootstrap credentials

- Continue GitHub-to-AWS OIDC.
- Store the AWS role ARN as non-secret configuration.
- Keep one least-privilege Cloudflare deployment API token in the protected GitHub production environment until Cloudflare provides a suitable workload identity flow.
- Never store long-lived AWS access keys in GitHub or SST.
- Limit the Cloudflare token to exact account resources and deployment actions required by the release controller.

### Non-secret configuration

Replace stable GitHub variables and `process.env` deployment parsing with a typed source-controlled stage configuration, likely under `infra/` or `packages/config/`.

Move values such as regions, product IDs, bucket names, public origins, service-account names, PostHog host, Sentry environment, and feature defaults into this configuration when they are not secrets.

Keep generated resource names and URLs as SST links or outputs rather than copying them into configuration.

### Rotation

Use overlapping credentials for any secret needed by independently deployed services:

1. Add `Current` and `Next` secret slots.
2. Deploy consumers that accept both.
3. Change producers to use `Next`.
4. Verify use of the new credential.
5. Keep `Current` valid throughout the rollback window.
6. Revoke and remove `Current` in a later release.

Never combine secret revocation with the code release that first uses the new secret.

## Deployment architecture

### Release classes

Classify every production change before deployment:

- Runtime-only: Worker or bridge code with no binding, schema, queue, or secret-contract change. Eligible for canary and automatic rollback.
- Expand migration: additive database change compatible with the current release. Deploy before runtime code.
- Event-contract expansion: consumer-first rollout followed by producer rollout. Automatic code rollback remains possible while both versions are supported.
- Infrastructure expansion: additive resource or permission change. Deploy separately through SST before dependent runtime code.
- Secret rotation: separate dual-secret procedure.
- Contract migration: removal or irreversible change. Manual approval after the compatibility window.
- Durable Object lifecycle migration: separate atomic Cloudflare deployment with dedicated review and no automatic rollback assumption.

Pull requests that mix runtime code with contract, secret revocation, or Durable Object lifecycle changes must be split before production.

### Runtime and infrastructure boundaries

Evolve the current single SST application into independently deployable runtime and infrastructure boundaries without replacing existing production resources:

- `mail-foundation`: Hyperdrive import/configuration, R2, Cloudflare queues, AWS SES/S3/SNS/SQS, IAM, domains, and durable bindings.
- `mail-api`: dedicated public Mail API Worker.
- `mail-sender`: outbound Cloudflare Queue consumer and SES adapter.
- `mail-inbound`: inbound MIME replication and ingestion consumer.
- `mail-events`: SES feedback processing consumer.
- `mail-webhooks`: customer webhook delivery consumer.
- `mail-automation`: mailbox actions, rules, connectors, and AI automation.
- `control-api`: independently deployed application backend and oRPC transport.
- `control-plane-web`: current web/dashboard frontend and thin server layer.
- `gmail`: Gmail realtime, Durable Objects, and Gmail-specific processing.
- `aws-bridges`: minimal inbound and feedback bridge functions, independently versioned where practical.

Before moving any existing resource between SST states:

1. Inventory the physical provider ID, SST URN, dependencies, and deletion policy.
2. Set retain/protection where supported.
3. Import or reference the existing resource in the destination state.
4. Preview both source and destination changes.
5. Prove neither plan deletes or replaces the production resource.
6. Move one resource family per release.
7. Preserve a reviewed recovery procedure for the SST state operation.

Do not create all new SST applications in one change.

### Dependency-aware builds and releases

CI must determine affected deployables from the workspace dependency graph, not from naive path matching.

- A change to one deployable entrypoint builds and releases only that deployable.
- A change to a shared package builds and tests every transitive deployable consumer.
- An infrastructure-only change does not rebuild unchanged runtime artifacts.
- A documentation-only change does not create a production runtime version.
- Build jobs may run in parallel, but promotions follow dependency order.
- Consumer compatibility releases deploy before producers that emit a new event version.
- `control-api` additive changes deploy before the corresponding `control-plane-web` release.
- Independent services may promote in parallel only when the release manifest contains no dependency edge between them.

Maintain a machine-readable deployable registry in `packages/deployment` containing artifact command, infrastructure component, health checks, dependencies, owned queues, and rollback policy. This registry drives CI matrices and release manifests; workflow YAML must not duplicate the service graph.

### Immutable artifacts

CI builds each deployable artifact once. Store:

- artifact archive.
- SHA-256 checksum.
- Git SHA.
- build tool and lockfile hash.
- compatibility date.
- source-map archive and upload result.
- generated Worker configuration excluding secret values.

Production promotion downloads and verifies the artifact. It does not rebuild it.

### Release manifest

Create a release manifest for every attempt containing:

- release ID and Git SHA.
- artifact checksums.
- previous and candidate Cloudflare Worker version IDs by service.
- previous and candidate Lambda alias versions for remaining bridges.
- database migration watermark.
- event schema versions emitted and consumed.
- infrastructure update ID when applicable.
- start, promotion, rollback, and completion timestamps.
- actor and workflow run URL.
- health-gate outcomes.

Store manifests in a durable restricted location and attach a sanitized copy to the GitHub deployment. Do not include secret values or private identifiers.

### Cloudflare Worker promotion

The target runtime release flow is:

1. Read and record the current active deployment.
2. Upload candidate Worker code and bindings as an inactive version.
3. Add release ID, Git SHA, and service name through version metadata.
4. Smoke-test the candidate through a preview URL or version override.
5. Create a deployment with candidate traffic at 1% and previous traffic at 99%.
6. Use version affinity for the Mail API so one client remains on one version during the canary.
7. Observe synthetic and real traffic.
8. Promote through configured stages such as 10%, 50%, and 100%.
9. Keep the previous version deployable through the full rollback window.
10. Finish only after the post-100% bake gate passes.

Low-volume services cannot rely on percentage traffic for evidence. Their promotion gates must use deterministic synthetic requests against the candidate version.

Because SST currently creates Worker code and secret bindings together, implement this in two increments:

- Initial increment: SST deploys the Worker to 100%, the workflow records the previous Cloudflare version, runs immediate checks, and uses native Cloudflare rollback on failure. Restrict this path to runtime-only releases.
- Final increment: the release controller obtains SST-linked values in memory, uploads an inactive Cloudflare version through the Cloudflare API, and promotes it separately. It must not persist or duplicate SST Secret values in GitHub, artifacts, logs, or files.

Investigate whether the pinned SST Cloudflare provider exposes separate Worker version and deployment resources before writing a custom uploader. Prefer a small SST component or provider resource if it preserves secret linking and inactive-version upload. Otherwise implement a narrow TypeScript release command in the deployment package.

### Automatic rollback

Automatic rollback applies only to runtime-only or compatible event-contract releases.

Before promotion, record the previous version. During every stage, evaluate:

- external synthetic API success and latency.
- candidate-specific uncaught exceptions.
- candidate-specific HTTP 5xx rate.
- database and Hyperdrive connection errors.
- outbox age and failed publication count.
- queue retry and consumer failure rate.
- SES submission error categories.
- customer webhook failure rate where the changed service affects webhooks.

Rollback procedure:

1. Confirm the candidate in the alarm is still part of the active deployment.
2. Use compare-and-set behavior so an old alarm cannot alter a newer release.
3. Promote the recorded previous version to 100%.
4. Disable further promotion for the failed release.
5. Mark the release failed and page the operator.
6. Leave database migrations, queue contents, and infrastructure untouched.
7. Preserve diagnostics and the failed candidate for investigation.

Add a protected manual workflow that accepts a release ID, displays the exact version changes, requires production approval, and restores traffic pointers without checkout, build, migration, or SST deployment.

Target and measure:

- confirmed regression to rollback initiation within 30 seconds.
- rollback initiation to restored traffic within 60 seconds.
- zero loss of accepted submissions during promotion and rollback.

Do not trigger code rollback for broad Cloudflare, PlanetScale, or SES outages. The previous version shares those dependencies. Provider-health incidents must pause deployments and invoke the relevant continuity runbook instead.

### Non-rollback changes

- Database: expand/contract only. Roll code back against the expanded schema. Use PITR only for data-loss incidents.
- Queues: queued messages remain. Consumers support current and prior schemas.
- Durable Objects: lifecycle migrations deploy separately and use forward-compatible code. Do not assume rollback is available.
- Infrastructure: apply reviewed forward correction. Never automatically deploy an old SST definition.
- Secrets: use overlap. Do not revoke credentials inside the rollback window.

## Health gates and observability

### Release metadata

Add a version metadata binding to every critical Worker. Include the version and release ID in server-side logs and Sentry tags, but do not expose infrastructure names in normal user-facing copy.

Provide an authenticated operational readiness endpoint per service. It should verify configuration presence and safe local initialization without sending customer data or placing full dependency load on every probe.

Add an end-to-end synthetic account and domain that can:

- authenticate to the Mail API.
- submit a uniquely identified synthetic message.
- observe the submission reaching `sent`.
- optionally observe delivery to a controlled mailbox.
- verify feedback processing and webhook dispatch.

Synthetic addresses, API keys, and message contents remain private and must not enter analytics.

### Required dashboards and alerts

- Mail API request count, success, 4xx, 5xx, and latency by release version.
- accepted submissions per minute.
- oldest unpublished outbox age.
- outbox publication attempts and failures.
- outbound queue depth, age, retries, and DLQ depth.
- SES send success, throttling, rejection, timeout, and unknown outcomes.
- accepted-to-sent latency distribution.
- feedback queue depth, age, and unresolved provider message IDs.
- inbound SQS and Cloudflare queue depth, age, and DLQs.
- S3 objects awaiting R2/database completion.
- webhook queue depth, age, attempts, and terminal failures.
- idempotency conflicts and duplicate consumer events.
- database connection, transaction retry, lock-wait, and failover symptoms.

Page on symptoms that threaten acceptance or permanent loss. Ticket lower-priority issues such as isolated customer webhook failures.

### Privacy

- Do not send message content, email addresses, API keys, organization IDs, mailbox IDs, webhook URLs, or private request parameters to Sentry, PostHog, Cloudflare analytics, or logs.
- Metrics may contain counts, durations, queue names, event types, status categories, and release IDs.
- Hashes used for deduplication must not be treated as anonymized analytics identifiers.

## Phased implementation

Each phase ends with a production-safe checkpoint. Do not begin the next destructive transition until the preceding acceptance criteria pass.

### Phase 0: Baseline and freeze unsafe release behavior

Goal: make the current release observable and manually reversible before changing the mail path.

Work:

- Document SLO definitions, RPO boundary, status semantics, and on-call ownership.
- Add release ID and Git SHA to deployed runtimes.
- Add external Mail API and core application smoke tests.
- Capture current Cloudflare deployment IDs before SST deploy.
- Add a protected manual Cloudflare Worker rollback workflow.
- Add post-SST smoke checks and fail the workflow when they fail.
- Remove routine SST secret copying; move missing values into SST Secrets.
- Move stable non-secret GitHub variables into typed deployment configuration.
- Add a deployment change classifier and block mixed irreversible/runtime releases.
- Correct `docs/deployment.md` so it no longer claims a failed cross-provider operation is globally atomic.

Likely files:

- `.github/workflows/sst-deploy.yml`.
- new protected rollback workflow under `.github/workflows/`.
- `docs/deployment.md` and a new availability/runbook document.
- `infra/runtime.ts`, `infra/stage.ts`, and new typed deployment configuration.
- `packages/env/src/sst-secrets.ts`, `infra/secrets.ts`, and generated SST resource types.
- `packages/deployment/` for release-manifest and Cloudflare deployment commands.
- Mail API tests under `apps/web`.

Acceptance criteria:

- An operator can identify the exact production Worker version and Git SHA.
- A manual rollback changes only Worker traffic and completes without rebuilding.
- A failed smoke test prevents a release from being marked successful.
- Routine deploy logs contain no application secret values.
- The deploy workflow no longer calls `sst secret set`.
- A dry-run exercise restores a known-good Worker version and then safely restores the current version.

### Phase 1: Durable submission ledger and transactional outbox

Goal: make the database commit the RPO 0 acceptance boundary while preserving the existing external endpoint.

Work:

- Add submission, outbox, and attempt schema through expand-only migrations.
- Generate the Quieter message ID and RFC Message-ID before provider submission.
- Refactor policy, suppression, and billing checks so the acceptance transaction reserves usage without holding a lock across network calls.
- Atomically commit submission, idempotency response, usage reservation, and outbox event.
- Return the accepted response before SES submission.
- Add outbox claim, retry, and reconciliation services.
- Keep the old synchronous path behind an emergency kill switch during initial shadow testing, but do not retain it as a long-term compatibility branch.
- Add status retrieval for a Quieter message ID.
- Update SDK response types without breaking the current `messageId` field.

Likely files:

- `packages/database/src/schema.ts` and generated migration.
- `packages/orpc/src/organization-mail.ts`.
- `packages/billing/src/organization-mail-usage.ts`.
- `packages/mail/src/send.ts`.
- `apps/web/src/routes/api/v1/send.ts`.
- `packages/sdk/` send and retrieval contracts.
- focused unit and migration integration tests.

Acceptance criteria:

- Killing the request runtime after the acceptance commit cannot lose the submission.
- Retrying with the same key returns the same Quieter message ID.
- Concurrent same-key requests do not send twice.
- A queue publication failure leaves a recoverable outbox row.
- The acceptance transaction performs no SES network call.
- The organization lock is not held while calling SES or Cloudflare Queues.
- Migration tests prove the currently deployed code still works with the expanded schema.

### Phase 2: Cloudflare outbound queue and sender

Goal: move outbound provider submission behind a durable Cloudflare queue.

Work:

- Add outbound Cloudflare Queue and DLQ in `infra/`.
- Add a dedicated queue consumer in `packages/cloudflare`.
- Reuse or extract provider-neutral send orchestration from `packages/orpc` and MIME code from `packages/mail` without making lower-level packages depend on app code.
- Link only SES permission, database, Sentry, and required SST Secrets to the sender.
- Implement atomic submission lease claiming and event deduplication.
- Persist attempt state before and after SES calls.
- Classify retryable, terminal, and ambiguous SES outcomes.
- Persist provider message mapping before downstream best-effort projections.
- Make usage finalization and managed-sent-mail projection recoverable, idempotent tasks rather than swallowed post-send promises.
- Add scheduled reconciliation for accepted, stale-sending, unknown, and sent-but-unprojected submissions.
- Shadow the consumer without sending, compare constructed payloads, then enable a synthetic organization, internal mail, a small customer cohort, and finally all traffic.

Likely files:

- `infra/mail.ts` initially, then a dedicated Cloudflare mail-data-plane infrastructure module.
- `packages/cloudflare/src/` new outbound consumer entrypoint.
- `packages/orpc/src/organization-mail.ts` and organization mail projection services.
- `packages/mail/src/send.ts`.
- `packages/database/src/schema.ts`.
- `packages/cloudflare` Worker-runtime tests.

Acceptance criteria:

- SES downtime increases queue age but does not fail new durable acceptances unless the database acceptance boundary is unavailable.
- Redelivering the same queue event does not create a second successful state transition or usage charge.
- Every SES message ID maps to a committed Quieter submission before feedback processing needs it.
- DLQ messages can be inspected and replayed without private data in logs.
- Synthetic accepted-to-sent latency and failure alarms operate in production.
- The old synchronous SES call is removed after the cohort rollout completes.

### Phase 3: Dedicated Mail API and control API boundaries

Goal: make dashboard releases incapable of interrupting transactional submissions or changing the application backend implicitly.

Work:

- Extract `/api/v1/send` and message-status endpoints from `apps/web` into a dedicated Cloudflare Worker package or app.
- Keep shared validation and business contracts in packages, not app-to-app imports.
- Give the Worker its own route, bindings, observability, deployment version, and health gates.
- Preserve the existing public URL through a stable route or compatibility proxy while introducing a dedicated API hostname if desired.
- Ensure the compatibility proxy has no database or business logic and cannot become a second acceptance path.
- Stop auth-mail code from calling the public API on the same service. Invoke the provider-neutral submission service through an appropriate internal binding or shared server package.
- Apply Mail API-specific rate limits that do not depend on per-isolate memory fallback for correctness.
- Inventory all dashboard server routes, oRPC endpoints, auth/session handling, uploads, and streaming behavior.
- Extract application backend procedures into a distinct `control-api` Worker while keeping `apps/web` as the control-plane frontend and thin SSR/BFF layer.
- Introduce frontend build identification and backend contract-version diagnostics.
- Add current-plus-previous frontend contract fixtures and CI compatibility tests before independently promoting either service.
- Use additive backend-first deployment order for the first independent control API release.
- Keep old browser sessions operating through the compatibility window; do not force reload as the normal solution.

Likely files:

- new app or package for the Mail API Worker.
- new control API Worker entrypoint under `packages/cloudflare` or a dedicated app if framework requirements justify it.
- `apps/web/src/routes/api/v1/send.ts` compatibility route or removal.
- `apps/web/src/start.ts` middleware and rate limiting.
- existing oRPC transport and routers under `apps/web` and `packages/orpc`.
- `apps/web/src/lib/stale-deployment.ts` for chunk recovery only, not API compatibility.
- `packages/auth/src/email.ts`.
- `infra/web.ts`, `infra/app.ts`, and new `infra/mail-api.ts` and `infra/control-api.ts` modules.
- `packages/orpc` and `packages/mail` shared contracts.

Acceptance criteria:

- Deploying or rolling back the dashboard does not create a new Mail API Worker version.
- Deploying or rolling back the dashboard does not create a new control API Worker version.
- The Mail API has an independent release ID, deployment history, Sentry release, and rollback action.
- The control API has an independent release ID, deployment history, Sentry release, and rollback action.
- Existing SDK clients continue working without endpoint changes.
- A deliberate dashboard outage does not affect transactional send acceptance.
- The current and preceding supported frontend builds pass against the candidate control API.
- An old browser session remains functional while the control API and frontend are deployed independently in both valid orders covered by policy.

### Phase 4: Harden inbound SES and feedback

Goal: guarantee durable AWS-local capture before Cloudflare-dependent processing.

Work:

- Insert SQS and DLQs between inbound SNS and processing.
- Keep the existing feedback SQS path but move business processing to Cloudflare after a durable handoff.
- Convert current AWS processors into minimal validated bridges or replace them with a safe Cloudflare pull design after testing operational behavior.
- Preserve original SNS/SES event IDs through every handoff.
- Increase S3 raw-mail retention beyond the maximum queue and incident-recovery window.
- Make S3-to-R2 replication asynchronous and idempotent.
- Mark the S3 object deletable only after canonical R2 storage and database ingestion are confirmed.
- Add orphan and mismatch reconciliation between S3, R2, queues, and Postgres.
- Move receipt-rule ownership into stable infrastructure without replacing the active production rule set.
- Retain existing delivery-event dedupe and recipient-state precedence behavior.

Likely files:

- `infra/mail.ts` split into foundation and bridge modules.
- `packages/aws/src/receipt.ts` and `packages/aws/src/outbound-feedback.ts` reduced to bridge responsibilities.
- new inbound and feedback consumers in `packages/cloudflare/src/`.
- `packages/orpc/src/managed-mail/messages/ingestion.ts`.
- `packages/orpc/src/organization-mail-delivery.ts`.
- `packages/aws/src/raw-mail-object.ts` and retention services.
- `packages/database/src/schema.ts` for handoff/reconciliation state.

Acceptance criteria:

- Disabling all Cloudflare inbound consumers does not lose SES-received messages.
- Restoring consumers drains the AWS and Cloudflare backlog idempotently.
- No S3 object expires while it remains the only durable MIME copy.
- R2 downtime delays replication but does not cause the AWS receipt event to disappear.
- Every queue and DLQ has age/depth alarms and a tested replay procedure.

### Phase 5: Mailbox actions and webhook reliability

Goal: remove remaining database-to-queue gaps and provide infrastructure-grade customer events.

Work:

- Route mailbox-action creation through the transactional outbox.
- Stop swallowing queue publication failures.
- Change run retry state so a failed execution can be reclaimed according to policy and can reach the DLQ.
- Make external connector effects use stable idempotency records and explicit unknown outcomes.
- Add customer webhook outbox, Cloudflare queue, signer, consumer, retries, endpoint health, and replay.
- Isolate webhook queues from mail send queues.

Likely files:

- `packages/orpc/src/mailbox-actions/enqueue.ts`.
- `packages/orpc/src/mailbox-actions/executor.ts`.
- `infra/actions.ts`.
- new webhook services under `packages/orpc` and `packages/cloudflare`.
- `packages/database/src/schema.ts`.

Acceptance criteria:

- A committed mailbox-action run cannot remain permanently stranded without a recoverable outbox record.
- Retried action events do not repeat recorded external effects.
- Customer webhook failures never block mail sending or feedback persistence.
- Operators can replay one webhook event or all failed events for one endpoint safely.

### Phase 6: Complete runtime deployable extraction

Goal: isolate remaining mail workloads by failure mode, queue pressure, permissions, and rollback decision before moving SST state ownership.

Work:

- Give `mail-inbound`, `mail-events`, `mail-webhooks`, and `mail-automation` distinct Worker resources and entrypoints.
- Give every deployable an independent queue or trigger, DLQ where applicable, bindings, SST Secret links, health checks, release metadata, Sentry release, and rollback policy.
- Separate inbound and feedback AWS bridges so a change or backlog in one cannot affect the other.
- Keep provider-neutral implementation in shared packages and make Worker entrypoints thin adapters.
- Add the machine-readable deployable registry and generate CI build/test matrices from the workspace dependency graph.
- Add ownership checks preventing a deployable from importing another deployable entrypoint.
- Add database table-family ownership documentation and tests or lint boundaries where enforceable.
- Verify no mail transport service synchronously depends on `control-api`, `control-plane-web`, `gmail`, `mail-webhooks`, or `mail-automation`.

Likely files:

- `packages/cloudflare/src/workers/` entrypoints.
- `packages/cloudflare/package.json` scripts and build configuration.
- `infra/mail.ts`, `infra/actions.ts`, and new service-specific infrastructure modules.
- `packages/deployment/` deployable registry and affected-service calculation.
- `.github/workflows/ci-main.yml` and reusable per-deployable build workflows.
- `packages/config` or repository boundary-check scripts.

Acceptance criteria:

- Every target deployable has a distinct Cloudflare Worker version history.
- A deployment of one service does not produce artifacts or infrastructure changes for unrelated services.
- Shared-package changes correctly identify all transitive deployable consumers.
- Pausing webhook or automation consumers does not affect Mail API acceptance, outbound sending, inbound capture, or feedback persistence.
- Pausing inbound processing does not consume outbound sender capacity.
- Each runtime receives only its documented bindings and secrets.

### Phase 7: Split SST infrastructure states

Goal: limit deployment blast radius while retaining SST as infrastructure and secret authority.

Work:

- Inventory and document every current SST resource and dependency.
- Define the destination stack boundaries listed above.
- Move stable imports first, then stateless runtimes, then durable resources only when import behavior is proven.
- Replace generated cross-stack URLs with explicit SST outputs or stable resource lookups.
- Keep provider details behind package boundaries.
- Add independent workflow concurrency groups for each production stack, plus a global lock for changes that cross boundaries.
- Require `sst diff` or preview artifacts and production approval for infrastructure workflows.
- Prevent routine runtime workflows from changing foundation resources.

Acceptance criteria:

- A control-plane release has no foundation, Mail API, sender, or mail-event infrastructure diff.
- A sender release cannot replace queues, buckets, routes, Hyperdrive, or SES configuration.
- No existing queue, bucket, Durable Object namespace, receipt rule, domain, or database binding is replaced during state migration.
- State recovery, refresh, unlock, and repair procedures are documented and exercised against a non-production stage.

### Phase 8: Native Cloudflare promotion and automated rollback

Goal: decouple Worker upload from traffic activation and make rollback a traffic-pointer operation.

Work:

- Implement or configure inactive Worker version upload while retaining SST-linked secret bindings.
- Add candidate-version smoke testing through preview URLs or version overrides.
- Add staged traffic promotion and version affinity.
- Implement release-specific health evaluation.
- Add compare-before-rollback and one-shot automatic rollback.
- Add a post-100% bake period.
- Store release manifests and expose deployment status to operators.
- Keep Durable Object lifecycle releases on a separate all-at-once path.

Likely files:

- `packages/deployment/` TypeScript commands and tests.
- `.github/workflows/` reusable build, promote, and rollback workflows.
- `infra/` version metadata and stable bindings.
- `packages/observability/` release tags and metric helpers.
- service-specific synthetic tests.

Acceptance criteria:

- Production runs the exact artifact CI tested.
- A candidate receives no normal traffic before smoke tests pass.
- A deliberately broken synthetic candidate automatically returns traffic to the prior version.
- Rollback does not run migrations, rebuild code, mutate secrets, or reconcile SST infrastructure.
- An alarm from an obsolete release cannot rollback a newer deployment.
- Measured rollback meets the 30-second initiation and 60-second restoration targets.

### Phase 9: Regional preparedness without multi-cloud ingress

Goal: prepare for AWS regional SES disruption without introducing a second public cloud ingress.

Work:

- Verify sender identities, DKIM, configuration sets, suppression policy, feedback topics, and quotas in a secondary SES region.
- Create least-privilege secondary-region permissions and SST Secrets/configuration as needed.
- Keep the Quieter acceptance ledger and Cloudflare outbound queue unchanged.
- Add a controlled provider-region switch for submissions not already in an ambiguous SES attempt.
- Never retry an `unknown` primary-region attempt in the secondary region without explicit duplicate-risk handling.
- Test region switching with synthetic mail.

Acceptance criteria:

- A primary SES regional outage causes queue backlog or controlled secondary routing, not loss of acknowledged submissions.
- Operators can identify submissions safe to retry and those in an ambiguous provider state.
- DNS and public Mail API ingress remain unchanged.

Multi-provider public ingress remains out of scope until measured availability or contractual commitments justify its complexity.

## Pull request sequence

Keep pull requests narrow. A suggested sequence is:

1. Release metadata, smoke endpoint, and deployment documentation correction.
2. Protected manual Worker rollback and release-manifest skeleton.
3. SST-only operational secrets and typed non-secret deployment configuration.
4. Submission/outbox schema expansion and migration tests.
5. Durable acceptance service behind a disabled feature gate.
6. Outbox publisher and reconciliation in shadow mode.
7. Cloudflare outbound queue, DLQ, and no-send shadow consumer.
8. Synthetic and internal mail cohort through the asynchronous path.
9. Public asynchronous acceptance rollout and synchronous SES path removal.
10. Dedicated Mail API Worker extraction.
11. Control API discovery, contract fixtures, and frontend build identification.
12. Independent control API Worker with additive backend-first cutover.
13. Inbound SQS/DLQ and S3 retention hardening.
14. Asynchronous S3-to-R2 and dedicated Cloudflare inbound Worker.
15. Dedicated feedback bridge and Cloudflare mail-events Worker.
16. Mailbox-action outbox repair and dedicated mail-automation Worker.
17. Customer webhook delivery platform and dedicated mail-webhooks Worker.
18. Deployable registry, dependency-aware CI matrix, and import boundaries.
19. SST stack-boundary migration, one resource family at a time.
20. Build-once artifacts and inactive Worker version upload per deployable.
21. Canary promotion, bake gates, and automatic rollback per deployable.
22. Secondary SES region preparation and game day.

Do not combine schema creation, traffic cutover, old-path deletion, and infrastructure state movement in one pull request.

## Testing strategy

### Unit and property tests

- Request hashing and idempotency conflict behavior.
- State-machine transition validity and stale-event rejection.
- Event schema decoding for current and prior versions.
- SES error classification, including ambiguous timeouts.
- Retry delay and lease-expiry behavior.
- Webhook signing and verification fixtures.
- Privacy filters for logs and observability.

### Database integration tests

- Concurrent acceptance with the same idempotency key.
- Transaction rollback at every acceptance step.
- Outbox claim concurrency and lease recovery.
- Duplicate queue event application.
- Usage reservation/finalization consistency.
- Feedback arriving before provider-message projection.
- Expand migration with the old application code and new code.

Use the repository's PostgreSQL migration service and run `vp run @quieter/database#db:test-migrations`.

### Worker integration tests

- Cloudflare Queue retry and partial acknowledgement behavior.
- Duplicate and out-of-order messages.
- Runtime termination after side effects but before acknowledgement.
- R2 upload checksum and orphan cleanup.
- Hyperdrive failover-like transient errors.
- Candidate version override and metadata behavior.
- Independent Worker build and deployment identity.
- Least-privilege bindings and absence of unrelated SST Secrets.

### Frontend/backend compatibility tests

- Current frontend contract against the candidate control API.
- Preceding supported frontend contract against the candidate control API.
- Candidate frontend against the current production control API contract.
- Old browser session behavior across backend-first deployment.
- New browser session behavior before and after frontend promotion.
- Additive enum, nullable field, procedure, and response-shape evolution.
- Typed upgrade-required handling after the compatibility window.
- Public `/api/v1` compatibility independent of control-plane releases.

Use `@cloudflare/vitest-pool-workers` through the existing `test:workers` command.

### End-to-end tests

- Accept, queue, send, feedback, webhook.
- Idempotent client retry after an intentionally dropped HTTP response.
- SES unavailable while acceptance continues and the queue grows.
- Database unavailable before acceptance, proving no false success response.
- Consumer rollback with old and new queue event versions present.
- Cloudflare candidate failure and automatic rollback.
- Inbound Cloudflare processing disabled longer than normal retry intervals, then recovered.
- S3-to-R2 failure and later reconciliation.

### Game days

Run in a production-like stage before enabling automated rollback, then quarterly:

- kill the outbox publisher.
- fail the outbound consumer.
- revoke candidate-only permissions.
- return SES throttling and timeouts.
- pause feedback and inbound bridges.
- inject poison queue messages.
- simulate PlanetScale failover connection errors.
- rollback during active queue processing.
- rotate a dual credential and rollback code.
- exercise SQS and Cloudflare DLQ replay.

Record actual detection and recovery times against the targets.

## Verification for repository changes

For every relevant implementation pull request:

```bash
vp check --fix
vp test
vp run @quieter/cloudflare#test:workers
vp run @quieter/database#db:check
vp run @quieter/database#db:test-migrations
vp run @quieter/aws#check:boundaries
vp run @quieter/aws#check:bundles
vp run @quieter/cloudflare#check:bundles
```

Run `vp run -r build` when shared packages, deployable artifacts, or infrastructure imports change. Run the relevant SST preview/diff for infrastructure changes. Never run a production migration or deployment locally.

## Security review gates

- Threat-model the dedicated Mail API before public cutover.
- Review organization isolation for every new submission, outbox, attempt, and webhook query.
- Verify every mailbox-scoped record and cache key includes `mailboxId` where applicable.
- Restrict the Cloudflare sender to SES send actions only.
- Restrict AWS bridges to exact source topic/queue and target operation.
- Encrypt or access-control raw MIME and attachments at rest.
- Define retention and deletion behavior for submissions, raw MIME, attempts, and webhook payloads.
- Validate customer webhook destinations against SSRF and DNS-rebinding attacks on every attempt.
- Ensure unexpected failures reach Sentry and expected user/authorization failures do not.
- Keep private mail data out of deployment manifests, logs, analytics, and metrics.

## Operational runbooks required before five-nines launch

- Bad Mail API release and Cloudflare rollback.
- Bad queue consumer release with mixed event versions.
- PlanetScale failover or connection exhaustion.
- Cloudflare Queue backlog and DLQ replay.
- SES throttling, account pause, identity failure, and regional outage.
- Ambiguous SES send attempts and duplicate-risk handling.
- Inbound SQS backlog and S3 recovery.
- R2 outage and delayed replication.
- Missing provider-message mapping reconciliation.
- Customer webhook backlog and targeted replay.
- SST state lock, refresh, repair, and imported-resource recovery.
- Dual-secret rotation rollback.

Each runbook must name the authoritative state, safe actions, prohibited actions, verification query or metric, escalation owner, and recovery completion condition.

## Completion definition

The program is complete when:

- Every successful Mail API response corresponds to a committed submission and recoverable outbox event.
- SES and queue outages delay mail but do not erase acknowledged submissions.
- Dashboard deployments cannot affect Mail API or sender versions.
- Dashboard deployments cannot implicitly deploy the control API, and control API deployments cannot rebuild frontend assets.
- Old browser sessions remain compatible with backend releases throughout the defined support window.
- Mail sender, inbound, feedback, webhook, automation, control API, web, and Gmail workloads have independent version histories and rollback decisions.
- Routine releases deploy immutable tested artifacts and do not reconcile durable infrastructure.
- Candidate Workers are tested before traffic, promoted gradually when supported, and automatically rolled back on confirmed candidate regressions.
- Manual rollback restores a previous Worker version without build, migration, secret mutation, or SST deployment.
- Database, event, Durable Object, infrastructure, and secret changes follow their separate compatibility procedures.
- All production queues have DLQs, alarms, replay tooling, and tested idempotency.
- All application and operational secrets reside in SST Secrets, except the unavoidable Cloudflare bootstrap credential.
- Synthetic monitoring proves the full accepted-to-sent path continuously.
- Game days demonstrate RPO 0 and measured rollback/recovery targets.
- The service has enough measured history and provider support commitments to justify a 99.999% external SLA.
