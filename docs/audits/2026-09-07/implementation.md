# Cleanup implementation

All 122 findings have a recorded resolution in [resolution.csv](resolution.csv). The original reports remain a historical record of the audited commit. The implementation is split into focused commits on `refactor/codebase-cleanup`.

Before the follow-up removal, application and library source was about 2,100 lines smaller across the affected files, excluding tests, declarations, generated route trees and documentation. This is a previous-revision measurement; the current diff and verification are pending.

## What changed

- Mail sending uses one durable coordinator for quota reservation, provider submission, uncertain outcomes, recovery, projections, billing and object cleanup. Rule forwarding runs outside database transactions and resumes stored decisions without resending uncertain deliveries.
- Custom actions, settings, graph execution, queue dispatch and consumption, and action-specific credit reservations are removed in the follow-up. Connectors remain available to chat, and managed inbox rules remain. Chat approvals are consumed before tool execution, and interrupted results remain visible.
- Mail contracts are provider-neutral. The mail router delegates to query, compose, label and mutation services. Gmail request handling stays server-side. The SDK shares those contracts and makes React optional.
- Browser state preserves newer cache data when optimistic changes fail. Compose and audio preparation are shared. The two demos share search, draft and mutation behavior; sending an unsaved draft no longer removes unrelated messages.
- Large mailbox, message, domain and connector screens now separate controllers, editors and substantial rendering sections. Dead paths, trivial wrappers, duplicate parsers and implementation-detail assertions were removed. Focused tests cover isolation, retries, billing and other core behavior.
- Database clients respect request boundaries and bounded pools. Import and deployment checks enforce package ownership. Rate-limit identities expire, webhook handling is separate, dependency advisories were patched, and peer dependencies are explicit.

## Verification, previous revision

| Check | Result |
| --- | --- |
| Full lint, formatting and TypeScript | Clean, 764 files |
| Unit tests | 797 passed |
| PostgreSQL integration tests | 58 passed |
| Native Cloudflare Worker tests | 45 passed |
| AWS and Cloudflare handler bundles | Eight passed |
| Package import boundaries | 641 source files and manifests checked |
| Cloudflare compatibility date and generated bindings | Passed |
| Migration structure, drift and safety | Passed |
| Production web build and deployment boundaries | Passed |

The authentication test initially exceeded its five-second deadline while other checks were running. Its module initialization now runs in setup, outside the timed authentication scenario, and the focused test passes.

Previous-revision Chrome verification covered the managed-demo inbox, organizer controls, message body, inspector and action-settings empty state. Demo saved-view editing is not implemented; the attempted save surfaced a failure. Authenticated domain changes and connector writes were not exercised in the browser.

The configured transcription model was probed with synthetic speech using the budget-limited development key. WAV, MP3, FLAC and Ogg succeeded; WebM, M4A and AAC were rejected. Browser-only formats therefore retain the shared WAV conversion path. The reported probe cost was $0.0024.

## Release requirements and limits

Apply `20260907233131_melodic_blacklash` through the protected migration workflow before the application release. It consolidates seven unpublished feature migrations. A read-only development-ledger check verified that none of the seven had been applied there. Main history remains unchanged. Drizzle's full snapshots are expected; only unapplied feature migrations may be consolidated. See [migration workflow](../../architecture.md#migration-workflow).

Custom action database tables and records remain untouched for expand/contract deployment. The new application cannot enqueue custom actions. Pause old dispatch and producers, drain in-flight action workers, and account for queued retries before retiring the old infrastructure. Confirm old consumers cannot resume; retained records alone do not disable deployed code. Defer table deletion until a separately reviewed contract migration after the rollback window.

`infra/mail-maintenance.ts` and `packages/cloudflare/src/mail-maintenance-worker.ts` retain send recovery, storage cleanup, rate-limit cleanup, and managed rule backfills every minute. Deploy this replacement alongside the application. Drain older send, ingestion, and rule workers as described in [the architecture notes](../../architecture.md). Connectors and chat remain supported. No production migrations or deployment were performed.

The previous verification used disposable loopback PostgreSQL 18.4; CI also passed historical migrations and integration tests against pgvector PostgreSQL 16. Those results predate this follow-up. Current removal, simplification, and consolidated-migration checks remain pending and must be recorded after completion. The original audit reports and resolution CSV remain historical records.
