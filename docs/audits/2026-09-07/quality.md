# Code quality and maintainability findings

These are separate from the immediate reliability fixes. P2 denotes a material maintainability or operational risk. P3 denotes smaller cleanup. Design recommendations are identified explicitly; they are not claims of observed incidents.

## F22

### P2: Architecture rules are stronger in AGENTS.md than in automated enforcement

Evidence: [packages/aws/scripts/check-import-boundaries.ts:4](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/scripts/check-import-boundaries.ts#L4), [apps/web/scripts/check-worker-deployment-boundaries.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/scripts/check-worker-deployment-boundaries.ts#L1), [package.json:11](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/package.json#L11).

The root boundary command checks the AWS source folder for a narrow set of oRPC import statements. Its regular expression misses dynamic imports and side-effect imports. Bundle checks add useful deployment protection, but they do not enforce the complete package architecture: packages must not depend on apps, application code must not query the database, and app code must use shared UI primitives.

Add restricted-import rules for direct imports and a dependency-graph check for transitive deployment boundaries. Use the existing lint/parser tooling rather than another handwritten source scanner. Keep the current bundle checks.

The application's withRequestDatabaseClient import is an infrastructure bootstrap concern. Encode that precise bootstrap allowance, or move the wrapper behind an application-facing server entry point. Do not grant broad database access to apps to accommodate it.

Validation: a few deliberately invalid import fixtures covering each boundary and dynamic imports. This checks an architectural contract that lint is meant to enforce.

## F23

### P2: Application-facing mail contracts still belong to the Gmail implementation

Evidence: [apps/web/src/lib/gmail/gmail.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/gmail.ts#L1), [packages/gmail/src/service.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L1), [packages/orpc/src/routers/mail.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/mail.ts#L1), [packages/orpc/src/managed-mail/messages/service.ts:230](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/service.ts#L230).

The application facade exports Gmail service types, while managed mail builds MessageListItem-compatible records and Gmail-shaped label concepts. The large mail router repeatedly chooses provider implementations. A provider's representation has become the shared domain contract.

This makes a managed-mail change depend on Gmail conventions and spreads provider branching into UI helpers and demos. It also makes it harder to reason about which imports are server-only. No browser credential leak was established.

Move neutral message, attachment, folder/category, and pagination contracts into the mail package. Make provider adapters normalize into them. Keep authorization and provider selection in the server service, with routers responsible for transport validation.

Do this operation by operation, beginning with read/list and compose. A generic adapter framework covering every hypothetical provider would add the same complexity in another place.

## F24

### P2: The database proxy includes avoidable runtime tricks

Evidence: [packages/database/src/client.ts:97](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L97), [packages/database/src/client.ts:138](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L138).

Request callbacks are distinguished by function.length, with a type predicate, a cast, and separate invocation paths. JavaScript already permits passing a client argument to a callback that ignores it. Default and rest parameters also make function.length an unreliable description of the callback's intent.

The exported proxy has a global override map that intercepts assignment. This accommodates mocking but puts mutable replacement behavior into the production database boundary.

Always invoke the callback with the client and use a single function type. Keep request-scoped database resolution, but remove test-only mutation behavior from the production proxy. Use the actual module boundary or explicit dependency injection in tests that need replacements.

Validation: retain tests of nested request scope and request isolation. Do not replace these simplifications with a new service locator.

## F25

### P2: Request-scoped database clients are created without a matching local lifecycle

Evidence: [packages/database/src/client.ts:119](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L119), [packages/database/src/client.ts:86](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L86).

Every top-level withRequestDatabaseClient call creates a pool. The wrapper never ends it. The installed postgres driver defaults idle_timeout to null. In a long-lived local Node process, successive requests can therefore retain separate connections beyond request completion until driver lifetime handling closes them. A per-pool max of one does not cap the process's total connections.

Outside an established scope, a linked Hyperdrive lookup also creates a fresh client per proxy resolution. That silently hides missing request scoping and can separate operations that callers expect to share one client.

Make the lifecycle explicit for each runtime. Close request-owned local clients after all dependent work has settled, or use an appropriate bounded local pool while retaining per-request Worker clients. Fail clearly for unscoped Worker database access. Coordinate this with fire-and-forget work such as F40 before introducing cleanup.

Validation: a sequence of local requests leaves a bounded number of connections, and concurrent Worker requests never share I/O-bound clients. Live connection counts were not available during this audit.

## F26

### P2: Error reporting drops operation context and can permanently disable itself

Evidence: [packages/observability/src/index.ts:13](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/observability/src/index.ts#L13), [apps/web/src/lib/server-error-reporting.ts:24](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/server-error-reporting.ts#L24), [packages/aws/src/sentry.ts:50](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/src/sentry.ts#L50).

Most service callers report an operation field. The web adapter reads boundary only, collapsing those failures into application. Other contextual fields are discarded there. At the shared reporter boundary, one exception from the reporter sets the reporter to null for the rest of that process or isolate.

The compose controller separately swallows discard failures and uses raw error text for send failures instead of the project's toastError behavior. See [apps/web/src/features/compose/components/use-compose-dialog-controller.ts:204](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/use-compose-dialog-controller.ts#L204) and [apps/web/src/features/compose/components/use-compose-dialog-controller.ts:532](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/use-compose-dialog-controller.ts#L532). A failed discard can leave the server draft present after it disappears from the cache.

Use one small typed error context across runtime adapters. Preserve operation and error cause, keep a local fallback when remote reporting fails, and do not permanently disable reporting after one exception. Route user-driven compose errors through toastError and restore or refresh optimistic state on failure.

Validation: reporter failure does not suppress the next error; a rejected discard is visible and leaves consistent UI state.

## F27

### P2: Optional browser storage can crash the application

Evidence: [apps/web/src/lib/query-persister.ts:106](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/query-persister.ts#L106), [apps/web/src/lib/query-persister.ts:145](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/query-persister.ts#L145), [packages/ui/src/components/ui/color-mode.tsx:57](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/color-mode.tsx#L57).

Query persistence directly enumerates and reads localStorage outside error handling. Its setItem recovery also accesses storage while handling a storage failure. Theme initialization reads localStorage during the provider's state initializer, and theme setters write without guarding failures.

When browser policy or storage availability causes a SecurityError, an optional cache or theme preference can break rendering. The bootstrap theme script catches errors, but the provider does not preserve that behavior.

Guard storage acquisition and operations in one small adapter. Treat unavailable persistence as an in-memory session. Keep the cache's existing exclusions for message bodies.

Validation: make storage acquisition throw, then verify that the app and theme toggle remain usable. A large matrix of browser quota edge cases is unnecessary.

## F28

### P2: Changing the authenticated session clears persistence but leaves the in-memory query client

Evidence: [apps/web/src/components/providers.tsx:28](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/providers.tsx#L28), [apps/web/src/components/providers.tsx:42](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/providers.tsx#L42), [apps/web/src/lib/query-persister.ts:106](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/query-persister.ts#L106).

The session boundary changes the persistence namespace, but the QueryClient lives for the provider lifetime. User-specific queries without a user dimension can remain in memory when the observed session changes outside the explicit sign-out flow.

Explicit sign-out and auth flows already clear queries, so this is a missing boundary guarantee rather than proof of an account switch disclosure. It becomes fragile with cross-tab session changes and future login flows.

Cancel outstanding user requests and clear or replace the client whenever the authenticated user identity changes. Reset mailbox and compose state at that same boundary. Preserve mailbox IDs on mailbox-specific keys.

Validation: change the session identity while the provider remains mounted and ensure previous account data is neither displayed nor persisted under the new account.

## F29

### P2: Request limiting puts coarse abuse traffic into the database and mixes webhooks with login traffic

Evidence: [packages/orpc/src/abuse-protection.ts:5](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/abuse-protection.ts#L5), [apps/web/src/start.ts:109](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/start.ts#L109), [apps/web/src/start.ts:124](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/start.ts#L124).

Every tracked mutation creates or updates a database row keyed by group and IP. Expired rows reset when reused, but no cleanup removes abandoned keys. The in-memory fallback also has no hard cap for still-active entries.

The auth group includes the Polar webhook endpoint and is limited to 20 writes per minute per source address. Provider webhook bursts share that budget even though they are unrelated to login attempts. Rejected deliveries can retry, but billing freshness now depends on a limit intended for another purpose.

Use platform ingress protection for coarse abuse, separate verified webhook intake from interactive auth limiting, and keep business quotas in the appropriate account-scoped service. If durable IP buckets remain, give them bounded retention. Read-only responses should not advertise a fresh remaining balance as if it were the caller's measured budget.

Validation: a realistic webhook burst and independent login traffic do not consume the same bucket.

## F30

### P2: The public SDK duplicates the contract and makes React mandatory

Evidence: [packages/sdk/src/index.ts:34](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L34), [packages/sdk/src/index.ts:134](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/src/index.ts#L134), [packages/mail/src/send.ts:362](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/send.ts#L362), [packages/sdk/package.json:37](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/sdk/package.json#L37).

The SDK manually copies request and response shapes. It omits the server's openTracking option. Its send result guard accepts an object with sent set to true even if the required messageId is absent. Other guards assert typed arrays without validating their elements.

The core entry point imports React email rendering, and React plus its type package are ordinary dependencies. Plain text API consumers inherit that dependency choice.

Generate or share the small public API contract without importing the backend implementation into the SDK. Use that contract for runtime boundary validation. Put React convenience rendering in an optional entry point, with appropriate peer dependencies.

Validation: build and use the published package from a tiny plain TypeScript consumer, and check a representative malformed response. Avoid duplicating every schema field in handwritten tests.

## F31

### P2: Semantic search cannot use the HNSW index with its current ordering expression

Evidence: [packages/orpc/src/ai-memory-embedding.ts:160](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/ai-memory-embedding.ts#L160), [packages/database/src/schema.ts:758](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L758).

The query orders descending by one minus cosine distance. The schema provides an HNSW cosine index, but pgvector requires ordering by the raw distance operator in ascending order to use that index. Its documentation explicitly shows the current expression as the non-indexed form. [pgvector index troubleshooting](https://github.com/pgvector/pgvector#why-isnt-a-query-using-an-index).

Order by cosine distance ascending and calculate similarity in the projection. Preserve filtering and evaluate recall when using approximate results with scope filters.

This is an established query-shape mismatch. Production latency and query plans were not available, and a table scan may still be appropriate for a small dataset. Validate with EXPLAIN on representative approved development data before claiming a performance improvement.

## F32

### P2: Large UI files still combine independently changing features

Evidence: [apps/web/src/features/navigation/components/mailbox-organizer.tsx:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/navigation/components/mailbox-organizer.tsx#L1), [apps/web/src/features/message-thread/components/message-view.tsx:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/components/message-view.tsx#L1), [apps/web/src/features/settings/components/organization-settings/domain-detail-view.tsx:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/organization-settings/domain-detail-view.tsx#L1), [apps/web/src/features/settings/components/action-simple-editor.tsx:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/action-simple-editor.tsx#L1).

The organizer contains more than 2,000 physical lines. Message view has more than 1,700, and domain detail more than 1,500. Length is only a signal. These files combine multiple dialogs, mutations, editing state, and independently meaningful sections, making an isolated change hard to review.

Split by user operation and ownership. For example, separate domain verification and DNS display from mailbox management; keep message loading separate from attachment/calendar actions; move organizer editors into their existing feature folders. Put generic primitives in packages/ui, and leave product orchestration in the application.

Preserve current density and interaction. Avoid a mechanical extraction of every JSX fragment or a new abstraction used once solely to satisfy a line limit. Verify the affected user flows rather than snapshotting the new component tree.

## F33

### P2: Demo mail is a second implementation embedded in production workflows

Evidence: [apps/web/src/lib/gmail/demo-mail.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/demo-mail.ts#L1), [apps/web/src/lib/managed-mail/demo-managed-mail.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/managed-mail/demo-managed-mail.ts#L1), [apps/web/src/features/compose/components/use-compose-dialog-controller.ts:218](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/use-compose-dialog-controller.ts#L218).

The two demo implementations total roughly 2,450 physical lines and maintain their own mail mutation behavior. Product controllers branch among Gmail demo, managed demo, and live operations.

That makes UI behavior depend on which copy of sending, drafts, labels, or mailbox state happens to run. The demos cannot establish that the real feature works locally, and adding a behavior requires changes in multiple models.

Keep demo data and a small in-memory transport adapter behind the same application contract as real mail. Reuse deterministic fixtures where possible. Use the existing local managed-mail and Worker fixtures to verify actual server behavior. A marketing demo can intentionally remain limited without implementing another mail system.

Validation: a small set of common contract scenarios for the fake transport, plus real local flows for integration behavior.

## F34

### P3: The shared theme package knows an application route

Evidence: [packages/ui/src/components/ui/color-mode.tsx:101](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/color-mode.tsx#L101), [apps/web/src/components/providers.tsx:68](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/providers.tsx#L68).

The bootstrap theme script forces dark mode when location.pathname is /home. The app provider independently implements the same route rule through forcedTheme. A reusable UI package now owns a product routing decision in two places.

Pass the forced theme into the bootstrap script from the app's root setup, using the same resolved decision as the provider. The UI package should implement theme mechanics.

A manual first-load and navigation check is enough. This cleanup does not need a new test suite.

## F35

### P3: Trivial helper functions contradict the project's stated simplicity rule

Evidence: [packages/orpc/src/text.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/text.ts#L1), [apps/web/src/lib/query-persister.ts:4](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/query-persister.ts#L4), [packages/database/src/client.ts:11](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/client.ts#L11).

hasText, isRecord, and isPresentString are examples of single-expression helpers that policy explicitly asks to inline. Similar null, undefined, and empty-string checks are also written in several inconsistent styles.

Apply the existing convention during scoped edits. Keep helpers for domain decisions, nontrivial transformations, and reusable workflows; inline the trivial guards. Do not introduce a central utility library of one-line predicates to standardize this.

This is a low-priority cleanup, not a reason to mix hundreds of unrelated formatting edits into the reliability fixes. No tests are needed for the inline-only changes.

## F36

### P3: CSS hue unit support is unreachable in the custom color fallback

Evidence: [apps/web/src/features/message-thread/domain/mail-html.ts:76](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-thread/domain/mail-html.ts#L76).

parseCssHue calls Number on the entire value before checking rad, turn, or grad suffixes. Inputs such as 0.5turn produce NaN and return early. Those unit branches never run. The rad suffix would also match grad if parsing reached that branch in its current order.

Either parse the numeric part and unit correctly or use a color parser that supports the needed CSS form. Keep this change small; one bug in a fallback does not justify rewriting email HTML rendering.

Validation: a short table of equivalent hue units produces equivalent colors.

## F37

### P3: Architecture documentation describes a deployment package that no longer owns the scripts

Evidence: [docs/architecture.md:72](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/docs/architecture.md#L72), [packages/deployment/tsconfig.json:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/deployment/tsconfig.json#L1), [scripts/run-sst.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/run-sst.ts#L1).

The architecture guide says packages/deployment contains deployment helper scripts. The tracked directory now contains only generated binding declarations and a TypeScript configuration; the helper scripts live under scripts.

Update the ownership map and decide whether the residual directory still serves type generation. Remove it only after checking generation references. Do not hand-edit its generated binding file to make the tree look cleaner.

Keep runbooks tied to actual startup commands and responsibility boundaries. No test is needed for this documentation correction.

## F38

### P2: Test priorities miss recoverability while some assertions lock down implementation choices

Evidence: [packages/orpc/tests/router-laziness.test.ts:6](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/router-laziness.test.ts#L6), [.github/workflows/ci-main.yml:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/ci-main.yml#L1), [packages/cloudflare/tests/worker.test.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/tests/worker.test.ts#L1).

The ordinary suite passes 734 tests, with 16 skipped across database-dependent suites. Separate Worker tests also pass. Yet F01 through F14 show gaps in core recoverability, replay, persistence, and concurrent spending behavior.

The router-laziness test, for example, requires every namespace to be lazy. The reason to preserve laziness is a safe and acceptable runtime dependency graph, which bundle checks can verify more directly. Requiring a particular construction helper can reject an equally safe refactor. It is a candidate for replacing with the underlying contract, not a justification for deleting broad portions of the suite.

Keep tests for mailbox isolation, token separation, billing boundaries, message parsing, migration safety, and queue behavior. Add the small failure/concurrency scenarios listed in the reliability report. Prefer a real disposable database for transaction behavior over a mock that cannot reproduce contention.

Do not add a coverage target, JSX snapshots, helper call-count assertions, or tests that merely duplicate Zod definitions. Never reset the shared development database to run these tests.

## F39

### P2: The custom action scheduler needs a deliberate keep-or-replace decision

Evidence: [packages/orpc/src/mailbox-actions/executor.ts:639](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L639), [packages/orpc/src/mailbox-actions/executor.ts:724](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L724), [packages/orpc/src/mailbox-actions/enqueue.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/enqueue.ts#L1), [infra/actions.ts:23](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/infra/actions.ts#L23).

The code owns queue dispatch, run leases, retry state, graph traversal, branch frames, step records, and external-effect replay. Despite those records, retries start a fresh execution queue instead of restoring completed steps. Frames are inserted as running and only their variables/timestamps are updated, so their stored status does not describe completion.

This is the clearest place where maintaining a custom technology is already costing correctness. F08, F09, and F14 are separate symptoms, not stylistic objections to one large file.

Run a bounded comparison using one representative action on Cloudflare Workflows, which already provides durable steps, retries, and persisted execution. Verify current runtime limits, local development, retention, cost, and deployment support before choosing it. Provider workflow durability does not itself make third-party writes exactly-once. [Cloudflare Workflows](https://developers.cloudflare.com/workflows/).

If keeping the current engine, reduce its supported semantics, remove unused persistence, and specify replay and ownership behavior explicitly. Do not add more graph node types while those guarantees are unresolved. If moving, retain existing run readers during an expand/contract transition and drain old work before removing tables.

## F40

### P2: Action AI usage reporting runs outside the awaited queue lifecycle

Evidence: [packages/orpc/src/mailbox-actions/executor.ts:595](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox-actions/executor.ts#L595), [packages/cloudflare/src/mailbox-action-worker.ts:32](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/src/mailbox-action-worker.ts#L32).

The usage callback launches an async function with void. Its writes are neither collected and awaited nor attached to the Worker execution context. The queue handler acknowledges once executeMailboxActionRun resolves and ignores its context parameter.

A run can therefore finish successfully while the last usage report is still in flight. Runtime termination or a failed write can leave unrecorded AI cost. The catch reports an error but creates no durable retry record.

Persist usage events as part of completed step results and drain them through the existing billing reporting path. Awaiting the immediate write is a small improvement; a durable pending event is the recoverable solution. Do not merely add a longer arbitrary delay before acknowledgement.

Validation: delay the final usage write and verify queue completion cannot lose its durable record.

## F41

### P2: Pinned dependencies have a large unresolved advisory backlog

Evidence: [pnpm-workspace.yaml:40](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/pnpm-workspace.yaml#L40), [pnpm-workspace.yaml:66](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/pnpm-workspace.yaml#L66), [pnpm-lock.yaml:4853](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/pnpm-lock.yaml#L4853).

GitHub's authenticated Dependabot API returned 80 open alerts across 19 package names: one critical, 29 high, 45 medium, and five low. The [alert snapshot](dependency-alerts.csv) records all 80 IDs, affected ranges, patch versions, and links. These are advisory counts, not 80 confirmed application vulnerabilities.

The catalog and overrides both pin Better Auth and related packages to 1.5.0. Other affected versions in the lockfile include Tiptap core 3.30.2, Hono 4.11.4, fast-uri 3.1.5, PostCSS 8.5.16, and undici 7.28.0. Dependency patches need active ownership; ordinary semver updates cannot move the explicitly pinned auth packages.

Initial applicability checks prevent overstating the risk:

| Advisory or group | What was verified |
| --- | --- |
| Critical Better Auth refresh-token replay, GHSA-pw9m-5jxm-xr6h | Requires the OIDC-provider or MCP auth plugin. Neither is configured in the inspected auth setup. A critical reachable application issue was not established. |
| Better Auth magic-link pre-account hijacking, GHSA-qq9h-g4jm-xgf3 | Magic links are enabled, but the advisory also requires open email/password registration. The inspected configuration does not enable email/password signup. Do not infer account takeover from the package version alone. |
| Tiptap core, GHSA-cp6q-959q-f8rh | Locked at 3.30.2; the alert identifies 3.30.4 as the first patched version. The editor is used by the app. Reachability of attacker-controlled prototype attributes was not demonstrated. |
| Valibot, GHSA-5qjj-4xww-7phc | GitHub still reports the alert, but the lockfile resolves 1.4.2, the alert's first patched version. Reconcile this stale alert instead of counting it as an unresolved vulnerable version. |
| Remaining transitive alerts | Inventory collected, but complete runtime reachability was not proved. GitHub's runtime/development classification is not a substitute for tracing the actual production bundle. |

The first two conditions come from the maintainers' [refresh-token advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-pw9m-5jxm-xr6h) and [magic-link advisory](https://github.com/better-auth/better-auth/security/advisories/GHSA-qq9h-g4jm-xgf3).

Upgrade coherent dependency families through vp, starting with auth and the editor. Review why each override exists before changing it, and remove obsolete pins. Reconcile already-fixed or inapplicable alerts with documented evidence and revisit them when enabling new plugins. Use the existing dependency alert service with a clear review cadence instead of building another scanner.

Validation: authentication, invitation acceptance, passkeys, editor paste/rendering, and deployment bundle compatibility. Do not blindly apply transitive major-version overrides or claim that a green lint run validates a security upgrade.
