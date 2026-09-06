# Second-pass scope and evidence

The first report concentrated too heavily on reliability and broad architecture. This pass adds specific UI defects, parser inconsistencies, small type and naming corrections, dead code, unused dependencies, and test-maintenance problems. Findings stay individually addressable, including the small ones. Repeated occurrences are listed separately rather than counted as dozens of independent bugs.

## Coverage

The application baseline remains `78621b3454b4fc304f41c6040c5c72577d2c0163`. The intervening commits contain audit documentation only. The original [966-file inventory](inventory.csv) still describes the repository boundary.

| Review | Extent and result |
| --- | --- |
| Source structure | Parsed 590 first-party implementation files without errors. Inventoried helper bodies, casts, effects, state, native controls, class conditions, promise wrappers, and imports. [File ledger](second-pass-files.csv). |
| Imports and tests | A second analysis parsed 704 tracked source, configuration, and test files, including all 113 test files, without errors. Resolved relative imports, app aliases, workspace exports, reexports, and literal dynamic imports. |
| Package entry points | Checked all 150 export targets across 16 manifests. An unused implementation was removed from the runtime-risk findings after this check proved it unreachable; it remains a dead-code finding, F113. |
| Runtime cycles | No static runtime cycle was found after excluding type imports and test edges. Computed dynamic loading is outside that result. |
| Repeated code | Compared normalized named function bodies across files and reviewed all 25 exact duplicate groups. [Decisions and locations](duplicate-review.csv). Small constructors and independent UI wrappers were not automatically consolidated. |
| React diagnostics | React Doctor 0.9.13 produced 110 diagnostics, including compiler and artifact checks. Each has a [triage entry](diagnostic-triage.csv). Scanner error labels are not audit priorities. |
| Unused code | Knip 6.34.0 ran with explicit entry points and configuration-executing plugins disabled. Source searches and the import graph verified retained findings; framework exports, CSS/configuration consumers, and public SDK contracts were not treated as dead solely because Knip flagged them. |
| App export visibility | Reviewed all 33 named app export candidates from the scan. The [row-by-row decisions](unused-exports.csv) distinguish 25 unnecessary exports from eight unused definitions. Internal-only helpers must keep their implementation; framework entry defaults remain. |
| Manual tracing | Followed UI handlers through RPCs, authorization, persistence, provider calls, and callbacks. The deeper second pass covers settings saves, mention editing, audio, search parsing and evaluation, rule backfills/retries, memory billing, connector isolation, and local tooling. |

The source ledger records structural inspection, not a claim of equally deep manual review of every line. Generated code, binary assets, dependencies, ignored local state, and live provider behavior were not exhaustively inspected. The scope includes the whole first-party repository; the report cannot certify that no undiscovered issue remains.

## Executed verification

The original checker, full tests, Worker tests, and bundle/migration checks remain documented in [scope.md](scope.md). Application code has not changed since those checks. This pass used focused probes instead of repeatedly running the full suite or adding tests that freeze the current implementation.

| Check | Result |
| --- | --- |
| Mail, Gmail, and SDK suites | `vp test packages/mail/tests packages/gmail/tests packages/sdk/tests`: 69 tests passed across 13 files. |
| Existing catch-all and prefetch suites | 11 tests passed across two files. |
| Managed search probes | Five isolated tests passed using the actual parser, evaluator, and Drizzle SQL generation. They demonstrated archived-state, repeated-filter, invalid-header, nullable-negation, and whitespace mismatches without opening a database connection. |
| Local Calendar isolation | The actual ICS service reached a mocked Calendar POST in local observe mode with no allowed Calendar account. No provider request was sent. This evidence is included in F42. |
| Storage backfill configuration | The actual script, with mocked clients and zero concurrency, reported one copied row while copying none. No database or object-storage request was sent. |
| Catch-all mutation probe | Removing four SQL predicates through an in-memory transform left all seven existing tests passing. This demonstrates their blind spot; it does not claim those predicates are absent from the source. |
| Prefetch mutation probe | Reversing two independent requests caused one of four tests to fail only on call ordering. The other three passed. This is evidence for removing the implementation-order assertion. |
| UI probes | Confirmed the mismatched multi-token signatures and the milestone normalization case that preserves the form key while leaving it dirty. Browser-specific undo or screen-reader behavior was not measured. |
| Mail and SDK probes | Actual exported functions reproduced search rewriting, destructive Unicode/header decoding, missing attachment exposure, sender/recipient parsing, encoded draft subjects, and discarded SDK URL prefixes. Injected fetch recorded requests without sending them. |
| Environment and asset probes | Dummy values demonstrated env-parser disagreement and failed JSON-to-dotenv round trips. The existing PNG checksum matched the installed Node CRC builtin. No local secret file or generated asset was overwritten. |

Reproduction scripts and isolated test configurations remain under ignored `.scratch/` in this checkout. They assert the audited behavior, including defects, and are deliberately not permanent regression tests. They are not part of the PR. Findings contain the inputs and expected correction needed to reproduce the issue independently.

## Recommendations that were rejected or narrowed

- Do not turn every `filter().map()` on a small UI list into a reducer or build a set for every short array.
- Do not remove memoization mechanically. Stateful client ownership and external subscription identity need individual review.
- Do not infer a resource leak merely because a diagnostic does not follow a disposer stored in a ref. The inspected canvas and recorder lifecycles have cleanup.
- Do not treat a server sourcemap as a browser asset. The flagged maps live under `dist/server`; the built Worker configuration serves static assets from `../client`. No browser secret exposure was established by those warnings.
- Do not replace a client-side form architecture because a scanner dislikes `preventDefault`.
- Do not replace bounded serial batches with unbounded parallel requests to satisfy an await-in-loop warning.
- Keep valid byte-level tests for wire formats, such as WAV headers. The problem is testing irrelevant implementation order or pretending a query-blind fake proves isolation.
- Do not remove old persisted-data compatibility solely because a branch looks old. Verify stored data and the migration contract first.
- Do not add a large graphics library merely to remove a small procedural PNG writer. Replacing its CRC loop with the already-supported Node builtin is justified; replacing its pixel-generation workflow was not.

## Mergeable groups

1. **Connector isolation and ownership:** consolidate the two execution paths, restore the local write guard, make grant checks and cancellation consistent. Include both create and invitation-import paths in validation.
2. **Rule execution and search contracts:** fix ownership before work, move backfill scheduling out of GET, protect checkpoints/cancellation, preserve retry progress, and align preview with execution. Reuse existing queue and database boundaries.
3. **AI memory access and error classification:** resolve the billing mailbox, enforce the existing entitlement gate, and preserve expected versus unexpected error handling.
4. **UI correctness:** settings save reconciliation, token-field signatures/IME/accessibility, mailbox-scoped async completion, and optimistic cache failure handling. Keep each independently reviewable.
5. **Mail fidelity:** preserve search syntax, address identity, Unicode, draft headers, and attachment availability. Prefer the existing parser facilities to another custom grammar.
6. **Small cleanup:** remove proven dead files/exports/dependencies, simplify the CRC/env parsing paths, align class conventions, and remove redundant wrappers and type declarations. These do not need a new testing framework or coverage target.

Avoid combining these groups into one application rewrite. A shared cause can support several findings, but the implementation should fix that cause once. No application fixes or production changes are included in this audit PR.
