# Cleanup implementation

All 122 findings have a recorded resolution in [resolution.csv](resolution.csv). The original reports remain a historical record of the audited commit. The implementation is split into focused commits on `refactor/codebase-cleanup`.

The follow-up removes about 5,200 application and library source lines compared with `a9469b22`. Consolidating the unpublished migrations reduces generated snapshots from 121,885 to 17,479 lines, removing 104,406 generated lines. These measurements describe the current follow-up.

## What changed

- Mail sending uses one durable coordinator for quota reservation, provider submission, uncertain outcomes, recovery, projections, billing and object cleanup. Rule forwarding runs outside database transactions and resumes stored decisions without resending uncertain deliveries.
- Custom actions, settings, graph execution, queue dispatch and consumption, and action-specific credit reservations are removed in the follow-up. Connectors remain available to chat, and managed inbox rules remain. Chat approvals are consumed before tool execution, and interrupted results remain visible.
- Mail contracts are provider-neutral. The mail router delegates to query, compose, label and mutation services. Gmail request handling stays server-side. The SDK shares those contracts and makes React optional.
- Browser state preserves newer cache data when optimistic changes fail. Compose and audio preparation are shared. The two demos share search, draft and mutation behavior; sending an unsaved draft no longer removes unrelated messages.
- Large mailbox, message, domain and connector screens now separate controllers, editors and substantial rendering sections. Dead paths, trivial wrappers, duplicate parsers and implementation-detail assertions were removed. Focused tests cover isolation, retries, billing and other core behavior.
- Database clients respect request boundaries and bounded pools. Import and deployment checks enforce package ownership. Rate-limit identities expire, webhook handling is separate, dependency advisories were patched, and peer dependencies are explicit.

## Verification, current follow-up

| Check | Verified result |
| --- | --- |
| `vp check` | Clean, 745 files |
| `vp test` | 793 passed, including three authentication request-scope regressions and six focused mail tests |
| PostgreSQL integration tests | 47 passed |
| Native Cloudflare Worker tests | 40 passed |
| Full historical migration test | Passed on local PostgreSQL 18.4 |
| AWS and Cloudflare handler bundles | Seven passed: three AWS, four Cloudflare |
| Package import boundaries | 620 source files and manifests checked |
| Schema, drift and migration safety | Passed |
| Production web build and Worker boundaries | Passed |
| Cloudflare typecheck | Passed |
| Browser verification | Passed the scoped managed-preview checks below |
| React Doctor, changes since `a9469b22` | 93/100; one existing settings-screen complexity warning |

Chrome verification through the managed preview confirmed that settings no longer show Actions, `tab=actions` normalizes to Overview, and Connectors still lists Google Calendar and Linear. An inbox thread opened and the chat composer loaded. No real connector writes or AI requests were made. After the lazy-initialization fix, an anonymous authentication GET returned HTTP 200 with `null`.

The React Doctor result covers only the follow-up changes since `a9469b22`. The broader main-branch scan did not complete, so no repository-wide score is claimed.

## Release requirements and limits

Apply `20260907233131_melodic_blacklash` through the protected migration workflow before the application release. It consolidates seven unpublished feature migrations. A read-only development-ledger check verified that none of the seven had been applied there. Main history remains unchanged. Drizzle's full snapshots are expected; only unapplied feature migrations may be consolidated. See [migration workflow](../../architecture.md#migration-workflow).

Custom action database tables and records remain untouched for expand/contract deployment. The new application cannot enqueue custom actions. Pause old dispatch and producers, drain in-flight action workers, and account for queued retries before retiring the old infrastructure. Confirm old consumers cannot resume; retained records alone do not disable deployed code. Defer table deletion until a separately reviewed contract migration after the rollback window.

`infra/mail-maintenance.ts` and `packages/cloudflare/src/mail-maintenance-worker.ts` retain send recovery, storage cleanup, rate-limit cleanup, and managed rule backfills every minute. Deploy this replacement alongside the application. Drain older send, ingestion, and rule workers as described in [the architecture notes](../../architecture.md). Connectors and chat remain supported. No production migrations or deployment were performed.

The previous verification used disposable loopback PostgreSQL 18.4; CI also passed historical migrations and integration tests against pgvector PostgreSQL 16. Those results predate this follow-up. Completed follow-up checks and their scope are recorded above. The original audit reports and resolution CSV remain historical records.
