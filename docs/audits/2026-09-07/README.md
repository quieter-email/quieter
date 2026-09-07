# Codebase audit, 7 September 2026

Implementation follow-up: all 122 findings now have recorded resolutions. See the [cleanup summary and verification limits](implementation.md) and [per-finding resolution ledger](resolution.csv). The reports below describe the original audited state.

The largest problems are duplicated business paths with different safeguards, unrecoverable side effects, and inconsistent state and data contracts. Smaller issues include dead code and exports, needless wrappers, misleading types and names, inconsistent shared controls, and tests that constrain harmless refactors while missing core boundaries.

The expanded audit contains **122 findings: 17 P1, 65 P2, and 40 P3**, including 81 additions from the second pass. It covers major reliability risks and small, concrete cleanup. Repeated occurrences are cataloged without counting each match as another finding. This is an audit report only; application behavior was not changed.

The evidence is pinned to commit [78621b3](https://github.com/quieter-email/quieter/commit/78621b3454b4fc304f41c6040c5c72577d2c0163). Every finding includes the relevant code, impact, a suggested correction, and proportionate validation. A finding can be high confidence from control flow without having been triggered against a real customer account.

- [Reliability findings, F01-F21](reliability.md)
- [Code quality and maintainability, F22-F41](quality.md)
- [Scope, coverage, verification, and limitations](scope.md)
- [File inventory at the audited commit](inventory.csv)
- [Dependency advisory snapshot](dependency-alerts.csv), with applicability qualifications in F41

- [Additional code quality findings, F42-F66](granular-quality.md)
- [Backend behavior and contracts, F67-F79](backend-details.md)
- [UI state and shared controls, F80-F91](ui-details.md)
- [Mail parsing, search, and SDK details, F92-F101](mail-details.md)
- [Small backend cleanup, F102-F106](small-cleanup.md)
- [Tooling, dead code, and test quality, F107-F122](tooling-details.md)
- [Second-pass scope, reproductions, and mergeable groups](second-pass.md)
- [Occurrence catalog](occurrences.csv), [duplicate review](duplicate-review.csv), and [diagnostic triage](diagnostic-triage.csv)
- [Filterable findings index](findings.csv) and [verified unused code/dependencies](verified-unused.csv)
- [All 33 reviewed app export candidates](unused-exports.csv), distinguishing private helpers from dead definitions

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
| [F41](quality.md#f41) | P2 | Pinned dependencies have an unresolved advisory backlog |
| [F42](granular-quality.md#f42) | P1 | Connector token handling is duplicated, and the copies already disagree |
| [F43](granular-quality.md#f43) | P2 | A refresh marks a connector unusable but still hands its token to the action |
| [F44](granular-quality.md#f44) | P2 | Connector cancellation stops at the token-refresh boundary |
| [F45](granular-quality.md#f45) | P2 | Omitting an optional owner silently widens connector authorization |
| [F46](granular-quality.md#f46) | P2 | Optional cache persistence participates in the mutation success contract |
| [F47](granular-quality.md#f47) | P2 | Whole-query rollback can erase mail received while an action is pending |
| [F48](granular-quality.md#f48) | P2 | Landing-page wrappers create a new React component on every render |
| [F49](granular-quality.md#f49) | P2 | BIMI caches expire values without bounding retained keys |
| [F50](granular-quality.md#f50) | P2 | Recording failures after startup disappear without an error contract |
| [F51](granular-quality.md#f51) | P3 | Audio support detection omits the microphone acquisition API |
| [F52](granular-quality.md#f52) | P3 | Twenty-two conditional class expressions violate the required object syntax |
| [F53](granular-quality.md#f53) | P3 | useEntrance is an ordinary value factory named like a React hook |
| [F54](granular-quality.md#f54) | P3 | Immediate values are needlessly wrapped in resolved promises |
| [F55](granular-quality.md#f55) | P2 | Automatic-label usage reporting is copied across provider services |
| [F56](granular-quality.md#f56) | P3 | Two settings screens independently define the same mailbox navigation contract |
| [F57](granular-quality.md#f57) | P3 | The Durable Object duplicates the shared Worker error response |
| [F58](granular-quality.md#f58) | P3 | QueryClient ownership uses a performance cache and redundant default objects |
| [F59](granular-quality.md#f59) | P3 | Window activity has different initial and subsequent definitions |
| [F60](granular-quality.md#f60) | P3 | A bounded stream reader uses async recursion for an ordinary loop |
| [F61](granular-quality.md#f61) | P3 | The two web JSON body readers have different resource and decoding rules |
| [F62](granular-quality.md#f62) | P3 | Strict event types are followed by impossible undefined checks |
| [F63](granular-quality.md#f63) | P2 | Chat unconditionally transcodes browser audio through a handwritten WAV encoder |
| [F64](granular-quality.md#f64) | P3 | Compose omits the transcription limits that chat checks before upload |
| [F65](granular-quality.md#f65) | P2 | Transcription error classification depends on English message prefixes |
| [F66](granular-quality.md#f66) | P3 | The recording value type is declared twice with the same fields |
| [F67](backend-details.md#f67) | P1 | Backfill ownership is checked after another mailbox's batch runs |
| [F68](backend-details.md#f68) | P2 | Reading backfill status is the scheduler, and processing stops without readers |
| [F69](backend-details.md#f69) | P2 | Backfill writes can resurrect cancelled jobs and overwrite concurrent progress |
| [F70](backend-details.md#f70) | P2 | Backfill advances past failures without a retry record or useful failure detail |
| [F71](backend-details.md#f71) | P2 | Rule preview ORs repeated filter types while execution ANDs every filter |
| [F72](backend-details.md#f72) | P2 | Accepted `is:archived` conditions never match archived messages in rules |
| [F73](backend-details.md#f73) | P2 | Separate text matchers disagree on nulls, whitespace, filenames, and free-text semantics |
| [F74](backend-details.md#f74) | P2 | The rule search assertion accepts invalid filters that SQL silently removes |
| [F75](backend-details.md#f75) | P1 | A partly applied rule can invalidate its own match and permanently skip remaining actions |
| [F76](backend-details.md#f76) | P2 | Label renames and deletions leave saved searches and rule predicates inconsistent |
| [F77](backend-details.md#f77) | P2 | Normal duplicate-name input escapes as an unexpected database error |
| [F78](backend-details.md#f78) | P1 | Interactive memory requests bypass entitlement and balance checks |
| [F79](backend-details.md#f79) | P2 | Memory RPCs turn arbitrary backend failures into verbatim user errors |
| [F80](ui-details.md#f80) | P2 | Saving reordered milestones can leave the form permanently dirty |
| [F81](ui-details.md#f81) | P2 | Usage settings accept edits during save and then discard them |
| [F82](ui-details.md#f82) | P2 | Managed mailbox name remains at an unsaved value after failure |
| [F83](ui-details.md#f83) | P3 | Clearing a Gmail name never reaches a clean saved state |
| [F84](ui-details.md#f84) | P2 | IME confirmation can submit an unfinished chat prompt |
| [F85](ui-details.md#f85) | P2 | Multiple mentions force a full editable-DOM rebuild on every input |
| [F86](ui-details.md#f86) | P2 | Settings search result activation requires a mouse-down event |
| [F87](ui-details.md#f87) | P3 | Domain mode cards look clickable but only their radio circles work |
| [F88](ui-details.md#f88) | P3 | Empty token suggestions advertise an active option that does not exist |
| [F89](ui-details.md#f89) | P3 | Keyboard shortcuts close button omits the required shared tooltip |
| [F90](ui-details.md#f90) | P3 | Message-image error handling uses a redundant ref and synchronization effect |
| [F91](ui-details.md#f91) | P2 | Transcription completion can append after the active mailbox changes |
| [F92](mail-details.md#f92) | P2 | Managed-mail invitations expose an action that requires a Gmail mailbox |
| [F93](mail-details.md#f93) | P2 | Parsing combined status filters silently keeps only the last one |
| [F94](mail-details.md#f94) | P2 | Search normalization changes quoted phrases and Boolean expressions |
| [F95](mail-details.md#f95) | P2 | Mojibake repair truncates unrelated Unicode characters |
| [F96](mail-details.md#f96) | P2 | Header decoding applies destructive HTML and zero-width cleanup to addresses and subjects |
| [F97](mail-details.md#f97) | P2 | An inline attachment can disappear from both exported attachment lists |
| [F98](mail-details.md#f98) | P2 | Sender extraction mistakes an email in the display name for the actual sender |
| [F99](mail-details.md#f99) | P2 | Recipient validation accepts a valid substring and silently drops another address |
| [F100](mail-details.md#f100) | P2 | Draft save responses return encoded subjects as editable text |
| [F101](mail-details.md#f101) | P3 | SDK base URL silently discards a configured path prefix |
| [F102](small-cleanup.md#f102) | P3 | Rule-history parsing constructs an argument it never reads |
| [F103](small-cleanup.md#f103) | P3 | A private division lookup carries an unused database override |
| [F104](small-cleanup.md#f104) | P3 | Subscription normalization is followed by impossible checks and a redundant alias |
| [F105](small-cleanup.md#f105) | P3 | Three files independently spell the same client-or-transaction type |
| [F106](small-cleanup.md#f106) | P3 | Live-sync token payload validation is copied between issuer and Worker |
| [F107](tooling-details.md#f107) | P2 | Zero backfill concurrency reports successful copies without doing them |
| [F108](tooling-details.md#f108) | P2 | The local Worker and Node commands parse the same env file differently |
| [F109](tooling-details.md#f109) | P2 | Secret refresh serializes dotenv values as JSON strings |
| [F110](tooling-details.md#f110) | P2 | Catch-all authorization and claim tests survive removal of every SQL predicate |
| [F111](tooling-details.md#f111) | P3 | Prefetch tests lock down independent call order and do not test their claimed deduplication |
| [F112](tooling-details.md#f112) | P3 | Five dependency declarations have no consumer in their owning workspace |
| [F113](tooling-details.md#f113) | P3 | A complete managed-message deletion implementation is unreachable |
| [F114](tooling-details.md#f114) | P3 | The unused contour renderer retains 323 lines and a lint exception |
| [F115](tooling-details.md#f115) | P3 | The browser terms-cookie writer has no caller |
| [F116](tooling-details.md#f116) | P3 | Obsolete compose and AI compatibility exports remain after caller migration |
| [F117](tooling-details.md#f117) | P3 | PR size label-definition synchronization can never run |
| [F118](tooling-details.md#f118) | P3 | The custom PNG CRC loop duplicates the supported Node builtin |
| [F119](tooling-details.md#f119) | P3 | A compiler exception is attached to a hook that does not match its rationale |
| [F120](tooling-details.md#f120) | P3 | App modules export internal helpers and retain unused small definitions |
| [F121](tooling-details.md#f121) | P3 | SettingsListRow and its exclusive style variant are dead |
| [F122](tooling-details.md#f122) | P3 | MailboxSettingsRow is an unused wrapper inside the live switcher module |

## How I would turn this into mergeable work

Start with the lost-data, unauthorized-work, repeated-action, and local provider-isolation risks. F42, F67, F75, and F78 add four P1 concerns to the original set. Avoid one repository-wide cleanup PR. The [second-pass grouping](second-pass.md#mergeable-groups) includes scoped UI and cleanup work.

| Workstream | Findings | Suggested boundary |
| --- | --- | --- |
| Recoverable sending | F01-F05, F16-F17 | Shared send lifecycle, durable attachment storage, quota reservation, then one MIME adapter |
| Reliable inbound mail | F06-F07, F13 | Persist receipt progress and post-ingestion work, distinguish failed checks from invalid domains |
| Chat action safety | F10 | Atomically consume approvals and persist tool outcomes independently of prose |
| Mailbox actions | F08-F09, F11, F14, F39-F40 | Stabilize identity and ownership, remove unsupported merge behavior, compare durable platform steps |
| Draft recovery and session isolation | F12, F15, F27-F28 | Mailbox-scoped compose state, safe storage, user-bound cache lifecycle |
| Small independent fixes | F18-F21, F31, F36 | Calendar parsing, return URLs, migration classification, SDK selector, index ordering, hue parsing |
| Architecture and cleanup | F22-F26, F29-F30, F32-F35, F37-F38 | Enforced package boundaries and focused extractions after behavior is stable |
| Dependency maintenance | F41 | Upgrade related packages together and reconcile alerts against enabled features and current resolved versions |

For sending and actions, introduce new operation records and compatible readers before removing old state. Drain existing jobs and preserve old message access during any storage transition. Those changes need expand/contract migrations and protected deployment; this audit performed neither.

The valuable tests here exercise contention, lost responses, restart recovery, attachment bytes, and mailbox isolation. Keep the suite focused on those contracts. Formatting-only cleanups, moving a component without changing behavior, and inlining a trivial predicate do not need new tests.

## What I would keep

Keep TanStack Query for server state, the existing mail authorization boundary, encrypted provider credentials, provider APIs behind server packages, linked SST secrets, and the current deployment bundle verification. The local Worker and managed-mail fixtures are useful infrastructure to build on.

Keep pgvector instead of building a separate vector service. Keep application-specific email rules and memory ranking where they express product behavior. The strongest candidates for reducing custom technology are MIME construction, iCalendar parsing, and durable workflow execution.

There is no need to split the database schema merely because it is long, rewrite every large component, or introduce a universal repository/service framework. Split code when responsibilities and ownership differ, and use one existing library or platform capability when it replaces a real subsystem.
