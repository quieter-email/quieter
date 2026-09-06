# Codebase audit, 7 September 2026

The repository has strong foundations: strict checking, explicit mailbox access rules, separate identity and mail OAuth, shared UI primitives, and deployment bundle checks. The main weakness is that successful external operations and local state are not consistently joined by a recoverable lifecycle. Sending, ingestion, chat approvals, and mailbox actions each handle that problem differently.

I found **40 actionable items: 13 P1, 23 P2, and 4 P3**. The first 13 deserve attention before expanding the affected features. The rest include concrete bugs, architecture corrections, and small cleanup. This is an audit report only; application behavior was not changed.

The evidence is pinned to commit [78621b3](https://github.com/quieter-email/quieter/commit/78621b3454b4fc304f41c6040c5c72577d2c0163). Every finding includes the relevant code, impact, a suggested correction, and proportionate validation. A finding can be high confidence from control flow without having been triggered against a real customer account.

- [Reliability findings, F01-F21](reliability.md)
- [Code quality and maintainability, F22-F40](quality.md)
- [Scope, coverage, verification, and limitations](scope.md)
- [File inventory at the audited commit](inventory.csv)

## Findings

P1 means fix before building further on the affected path. P2 means schedule a scoped correction. P3 means opportunistic cleanup. These labels express engineering priority, not a security scoring system.

| Finding | Priority | Problem |
| --- | --- | --- |
| [F01](reliability.md#f01) | P1 | Mail usage locking can deadlock locally and is unsupported through Hyperdrive |
| [F02](reliability.md#f02) | P1 | Failed API sends strand idempotency keys |
| [F03](reliability.md#f03) | P1 | Accepted sends can lose local records and accounting |
| [F04](reliability.md#f04) | P1 | Managed draft and sent attachment bytes are not persisted |
| [F05](reliability.md#f05) | P1 | Composer sends race spending limits and lack idempotency |
| [F06](reliability.md#f06) | P1 | Receipt cleanup prevents reliable usage retries |
| [F07](reliability.md#f07) | P1 | Post-ingestion failures permanently skip automation |
| [F08](reliability.md#f08) | P1 | Action retries can duplicate writes or replay another operation |
| [F09](reliability.md#f09) | P1 | Action leases lack renewal and stale-owner protection |
| [F10](reliability.md#f10) | P1 | Concurrent chat approvals can execute the same action twice |
| [F11](reliability.md#f11) | P1 | Mailbox actions lack execution-time AI budget enforcement |
| [F12](reliability.md#f12) | P1 | Failed close-save clears draft recovery resources |
| [F13](reliability.md#f13) | P1 | Transient domain verification failures can disable inbound eligibility |
| [F14](reliability.md#f14) | P2 | Wait-all graph merges are implemented as pass-through |
| [F15](reliability.md#f15) | P2 | Compose handoff is unscoped and consumed during render |
| [F16](reliability.md#f16) | P2 | Duplicate MIME writers emit invalid or changed messages |
| [F17](reliability.md#f17) | P2 | Compose structural headers permit newline injection |
| [F18](reliability.md#f18) | P2 | Calendar parsing confuses alarm and event properties |
| [F19](reliability.md#f19) | P2 | A duplicate return URL helper permits external redirection |
| [F20](reliability.md#f20) | P2 | Migration safety checks miss destructive legal syntax |
| [F21](reliability.md#f21) | P2 | CI's SDK build selector silently matches no package |
| [F22](quality.md#f22) | P2 | Automated architecture checks cover only part of the policy |
| [F23](quality.md#f23) | P2 | Shared mail contracts still belong to the Gmail implementation |
| [F24](quality.md#f24) | P2 | Database callback dispatch and mocking proxy are overcomplicated |
| [F25](quality.md#f25) | P2 | Request-owned local database pools have no explicit cleanup |
| [F26](quality.md#f26) | P2 | Error reporting loses context and compose failures are inconsistently handled |
| [F27](quality.md#f27) | P2 | Optional browser storage can crash rendering |
| [F28](quality.md#f28) | P2 | Session changes do not reset the in-memory query client |
| [F29](quality.md#f29) | P2 | Database IP limiting lacks retention and conflates webhooks with login |
| [F30](quality.md#f30) | P2 | SDK contracts drift and React rendering is a mandatory dependency |
| [F31](quality.md#f31) | P2 | Semantic search ordering prevents HNSW use |
| [F32](quality.md#f32) | P2 | Large UI modules combine independently changing responsibilities |
| [F33](quality.md#f33) | P2 | Demo mail duplicates production domain behavior |
| [F34](quality.md#f34) | P3 | Shared theme code hardcodes an application route |
| [F35](quality.md#f35) | P3 | Trivial helpers contradict the simplicity convention |
| [F36](quality.md#f36) | P3 | CSS hue unit parsing has unreachable branches |
| [F37](quality.md#f37) | P3 | Architecture documentation has a stale deployment ownership map |
| [F38](quality.md#f38) | P2 | Tests need core failure scenarios rather than implementation assertions |
| [F39](quality.md#f39) | P2 | The custom workflow engine needs a bounded keep-or-replace decision |
| [F40](quality.md#f40) | P2 | Action usage reporting is outside the awaited queue lifecycle |

## How I would turn this into mergeable work

Start with the lost-data and repeated-action risks. Avoid one repository-wide cleanup PR.

| Workstream | Findings | Suggested boundary |
| --- | --- | --- |
| Recoverable sending | F01-F05, F16-F17 | Shared send lifecycle, durable attachment storage, quota reservation, then one MIME adapter |
| Reliable inbound mail | F06-F07, F13 | Persist receipt progress and post-ingestion work, distinguish failed checks from invalid domains |
| Chat action safety | F10 | Atomically consume approvals and persist tool outcomes independently of prose |
| Mailbox actions | F08-F09, F11, F14, F39-F40 | Stabilize identity and ownership, remove unsupported merge behavior, compare durable platform steps |
| Draft recovery and session isolation | F12, F15, F27-F28 | Mailbox-scoped compose state, safe storage, user-bound cache lifecycle |
| Small independent fixes | F18-F21, F31, F36 | Calendar parsing, return URLs, migration classification, SDK selector, index ordering, hue parsing |
| Architecture and cleanup | F22-F26, F29-F30, F32-F35, F37-F38 | Enforced package boundaries and focused extractions after behavior is stable |

For sending and actions, introduce new operation records and compatible readers before removing old state. Drain existing jobs and preserve old message access during any storage transition. Those changes need expand/contract migrations and protected deployment; this audit performed neither.

The valuable tests here exercise contention, lost responses, restart recovery, attachment bytes, and mailbox isolation. Keep the suite focused on those contracts. Formatting-only cleanups, moving a component without changing behavior, and inlining a trivial predicate do not need new tests.

## What I would keep

Keep TanStack Query for server state, the existing mail authorization boundary, encrypted provider credentials, provider APIs behind server packages, linked SST secrets, and the current deployment bundle verification. The local Worker and managed-mail fixtures are useful infrastructure to build on.

Keep pgvector instead of building a separate vector service. Keep application-specific email rules and memory ranking where they express product behavior. The strongest candidates for reducing custom technology are MIME construction, iCalendar parsing, and durable workflow execution.

There is no need to split the database schema merely because it is long, rewrite every large component, or introduce a universal repository/service framework. Split code when responsibilities and ownership differ, and use one existing library or platform capability when it replaces a real subsystem.
