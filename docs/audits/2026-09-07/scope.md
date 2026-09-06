# Scope and verification

## What was covered

Baseline: commit 78621b3454b4fc304f41c6040c5c72577d2c0163 on main, with a clean working tree when the audit began.

The first-party inventory contains 966 tracked files across the app, packages, infrastructure, scripts, workflows, documentation, and root configuration. It classifies 604 source files, 113 test files, 60 migration files, 78 generated files, 49 configuration files, 25 documentation files, and 37 assets or other files. The inventory excludes vendored agent skill content under .agents. It also excludes ignored build output, dependencies, SST state, local credentials, and this report.

The review combined repository-wide policy and dependency searches, source and test inspection, end-to-end control-flow tracing across packages, local reproductions, and the existing checks. Manual depth varied: core mail, authorization, billing, AI/action execution, persistence, and runtime boundaries received the deepest review. The file inventory records scope and file type; it is not a claim that every generated line or every JSX line received an equally deep manual review.

Generated route trees, binding declarations, and migration snapshots were assessed through their ownership, generation paths, and validation. They were not hand-edited. Assets were inventoried; the audit was not a visual design review or an inspection of every binary asset.

| Area | Tracked files | Review focus and result |
| --- | --: | --- |
| apps/web | 386 | Routes and server middleware, compose, mailbox/query state, message rendering, search, navigation, settings, consent and error paths. Main findings F12, F15-F19, F26-F29, F32-F36. |
| packages/ai | 23 | Model/tool boundaries, action execution inputs, usage callbacks, context handling. Cross-package findings F08-F11 and F40. |
| packages/auth | 18 | Identity OAuth scope separation, session/access hooks, organization and API-key boundaries, deletion paths. No additional validated auth finding beyond the cross-package risks. |
| packages/aws | 17 | Receipt, feedback, raw-object retention, runtime reporting, safe imports and bundles. F06-F07 and F26. |
| packages/billing | 25 | Entitlements, credits, send allowance, idempotent usage, subscription/provider boundaries. F01, F03, F05-F06, F11 and F40. |
| packages/cloudflare | 25 | Queue acknowledgement/retry, action dispatch, Gmail maintenance, live sync, request database scope, local bindings and runtime tests. F09, F25 and F40. |
| packages/config | 4 | Shared compiler settings and ownership. Enforcement gaps are in F22. |
| packages/database | 142 | Client lifecycle, schema ownership and relationships, indexes, migration generation/checking and operation guards. F01, F20, F24-F25 and F31. |
| packages/deployment | 2 | Residual generated bindings and TypeScript configuration. F37. |
| packages/env | 13 | Central parsing, linked secret binding resolution, local configuration and allowlist safeguards. No separate validated finding. |
| packages/gmail | 7 | REST/service boundary, MIME/attachments, token use, public type coupling. F16-F17 and F23. |
| packages/mail | 26 | Neutral mail contracts, raw parsing, send and compose MIME, attachment representations and schemas. F04, F16-F17 and F23. |
| packages/observability | 3 | Reporter configuration and failure handling across runtimes. F26. |
| packages/orpc | 134 | Authorization and routers, managed mail, domain verification, Gmail sync, AI memory, chat, connectors, mailbox actions, spending and API sending. Most cross-package reliability findings originate here. |
| packages/sdk | 8 | Public inputs/results, runtime validation, rendering dependency, package build and publish configuration. F21 and F30. |
| packages/ui | 50 | Shared primitive ownership, theme state and browser storage, app-specific routing leakage. F27 and F34. |
| infra | 11 | Resource ownership, secrets, database binding, queue/DLQ/runtime limits, deployment integration. F01, F09 and F39-F40. |
| scripts | 18 | Local setup and secret linkage, Worker fixtures, provider relays, prepared builds, recovery and deployment probes. No additional validated finding. |
| .github | 12 | CI, deployment, SDK publishing, maintenance/recovery workflows and protected mutation paths. F20-F22 and F38. |
| docs | 13 | Architecture and local/operational runbooks checked against commands and current ownership. F37. |
| root | 29 | Workspace scripts, Vite/lint configuration, package ownership and entry-point tooling. F21-F22 and F38. |

"No separate validated finding" means the reviewed paths did not produce an additional supported issue. It is not a certification that the area is bug-free.

## Checks executed

| Command | Result | What it establishes |
| --- | --- | --- |
| vp check | Passed. Formatter checked 861 files; lint/type checking covered 703 files. | Existing automated formatting, lint and type rules pass. |
| vp test | Passed. 107 files passed, 3 skipped; 734 tests passed, 16 skipped. | Ordinary configured behavior suite is green. Database-dependent skipped tests did not execute. |
| vp run check:boundaries | Passed. | Current AWS direct-import policy passes. Its scope is narrower than all project boundaries, see F22. |
| vp run check:bundles | Passed. | Three AWS and five Cloudflare handler bundles satisfy the current checks. |
| vp run db:check | Passed. | Current migration files, drift checks and configured safety rules pass. F20 demonstrates a gap in the safety classifier itself. |
| vp run @quieter/cloudflare#test:workers | Passed. Three files, 41 tests. | Local Worker runtime and queue scenarios covered by that suite pass. |
| vp run @quieter/sdk#build | Exit 0 with no SDK build task. | Reproduces the incorrect selector in F21. |
| vp run quieter#build | Passed and produced the SDK bundle and declarations. | Confirms the package's actual build task is usable. |
| Temporary audit reproduction suite | Seven tests passed, asserting the observed defects described below. | Confirms isolated MIME, header, calendar and migration behavior. The temporary file was removed after the audit. |
| Node URL reproduction through vp exec | Guard accepted the slash/backslash path; URL resolved to https://example.org/. | Confirms F19 without contacting that destination. |

The Worker suite prints expected injected failures for its retry scenarios and dependency source-map warnings. Those are not findings. The check counts above describe the audited baseline. No application source was changed. The report Markdown was formatted separately, and no permanent test suite was added.

A full recursive production web build was not run. Handler bundle checks and the SDK build were run. Browser end-to-end flows and real sending were not run, so user-interface and provider-failure findings are marked as control-flow evidence rather than claimed live reproductions.

## Local reproductions

The seven temporary tests described current behavior, rather than pretending to be regression tests for fixes that have not been made. Keeping assertions of the broken behavior in the normal suite would be misleading.

| Input or scenario | Observed result | Finding |
| --- | --- | --- |
| Send a raw message with 110 repeated ASCII characters as Subject, then parse it | Parsed subject contains 111 characters | F16 |
| Subject begins with 35 ASCII characters, then é and further text | First encoded word ends with an incomplete UTF-8 sequence; fatal decoding rejects it. postal-mime tolerates the complete header. | F16 |
| Unicode display name followed by an email address in angle brackets | Entire From value, including address syntax, is placed in one encoded word | F16 |
| Compose plain text containing 1,200 repeated ASCII characters | A quoted-printable physical line is 1,200 characters | F16 |
| Draft anchor sourceMessageId contains CRLF followed by X-Audit-Injected: yes | Input validation accepts it and raw MIME gains that structural header | F17 |
| New migration uses ALTER TABLE "mailbox" DROP "displayName" or renames the table | Safety assertion accepts both statements | F20 |
| VEVENT has a nested VALARM description before its own description | Calendar draft takes the alarm description as the event description | F18 |

Additional concurrency and data-loss findings were traced in source. They were not tested by creating real sends, calendar events, issues, production database writes, or competing Gmail watches.

## External verification and limits

The PlanetScale connector could list the organization. Database discovery then returned HTTP 403. Consequently, no production or development query telemetry, EXPLAIN plan, connection count, database size, or data distribution was retrieved. F31 is supported by the exact query shape and pgvector's documented index requirements, not a measured production slowdown.

Provider documentation was consulted for Hyperdrive's unsupported advisory locks, pgvector index ordering, PostgreSQL ALTER TABLE grammar, MIME encoding requirements, and the proposed Cloudflare Workflows comparison. Sources are linked beside the corresponding findings.

The authenticated GitHub API also returned 80 open Dependabot alerts. Their complete metadata inventory is in dependency-alerts.csv. F41 compares selected alerts with the current lockfile and enabled auth plugins, including an apparently stale alert and prerequisites absent from the app. Complete exploitability analysis of every transitive dependency was not performed; the advisory count is not a count of confirmed application vulnerabilities.

No secrets are included in this report. No database mutation, migration application, provider write, infrastructure deployment, billing change, or new paid service was performed. Local tests used their configured fixtures and mocks. The audit did not provision or reset a database.

## How to use the inventory

inventory.csv contains the tracked path, ownership area, physical text line count, and file classification at the baseline commit. Source counts include runtime code, configuration written as code, scripts, and styles. Text counts include a final empty line where present, so they should be treated as navigation aids, not complexity scores.

The large generated migration snapshots explain the high total text size under packages/database. Do not use that generated volume as evidence that handwritten database code needs a wholesale split. The report instead identifies concrete lifecycle, safety, and index issues.

When implementing findings, keep their IDs in PR descriptions and close them with a description of the resulting behavior and relevant verification. Avoid marking a finding resolved solely because its code moved to a different file.
