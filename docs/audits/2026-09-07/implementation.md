# Cleanup implementation

All 122 findings have a recorded resolution in [resolution.csv](resolution.csv). The original reports remain a historical record of the audited commit. The implementation is split into focused commits on `refactor/codebase-cleanup`.

Application and library source is 2,099 lines smaller across the affected files, excluding tests, declarations, generated route trees and documentation. Generated migration snapshots account for most of the added repository lines.

## What changed

- Mail sending uses one durable coordinator for quota reservation, provider submission, uncertain outcomes, recovery, projections, billing and object cleanup. Rule forwarding runs outside database transactions and resumes stored decisions without resending uncertain deliveries.
- Actions persist external-write plans, fence stale workers, reuse completed decisions and enforce attempt limits. Execution rechecks mailbox access and billing, reserves headroom, and stops automatic execution when billing cannot be recorded. Chat approvals are consumed before tool execution, and interrupted results remain visible.
- Mail contracts are provider-neutral. The mail router delegates to query, compose, label and mutation services. Gmail request handling stays server-side. The SDK shares those contracts and makes React optional.
- Browser state preserves newer cache data when optimistic changes fail. Compose and audio preparation are shared. The two demos share search, draft and mutation behavior; sending an unsaved draft no longer removes unrelated messages.
- Large mailbox, message, domain and action screens now separate controllers, editors and substantial rendering sections. Dead paths, trivial wrappers, duplicate parsers and implementation-detail assertions were removed. Focused tests cover isolation, retries, billing and other core behavior.
- Database clients respect request boundaries and bounded pools. Import and deployment checks enforce package ownership. Rate-limit identities expire, webhook handling is separate, dependency advisories were patched, and peer dependencies are explicit.

## Verification

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

Chrome verification covered the managed-demo inbox, organizer controls, message body, inspector and action-settings empty state. Demo saved-view editing is not implemented; the attempted save surfaced a failure. Authenticated domain changes and connector writes were not exercised in the browser.

The configured transcription model was probed with synthetic speech using the budget-limited development key. WAV, MP3, FLAC and Ogg succeeded; WebM, M4A and AAC were rejected. Browser-only formats therefore retain the shared WAV conversion path. The reported probe cost was $0.0024.

## Release requirements and limits

Apply the additive migrations before the application release and drain older send, rule and action workers as described in [the architecture notes](../../architecture.md). Keep historical records and compatible readers during the transition. No production migrations or deployment were performed.

Local integration tests used disposable loopback PostgreSQL 18.4 with the selected tables and new migrations. The full historical migration sequence requires the pgvector database configured in CI; it was not executed against this local installation. Provider and billing-entitlement boundaries were mocked in the database tests, while database queries, locks, claims and persistence were real.

Each paid action run reserves 25 cents for up to five minutes. This prevents competing action runs from allocating the same headroom. It is not a hard provider spending cap: an in-flight model step can exceed the allowance, and other AI features retain their existing credit checks. Reservations are separate from actual billed usage.

The restricted action executor remains on Cloudflare Queues. A second orchestration platform was not added. Uncertain external effects require review rather than automatic replay.
