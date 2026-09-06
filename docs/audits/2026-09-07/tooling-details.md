# Tooling, dead code, and test quality

Additional findings at the original application baseline. Pinned source links support the reported behavior; validation distinguishes local reproductions from source-only traces.

## F107

### P2: Zero backfill concurrency reports successful copies without doing them

Evidence: [backfill-managed-mail-r2.ts:11](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/scripts/backfill-managed-mail-r2.ts#L11), [line 51](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/scripts/backfill-managed-mail-r2.ts#L51), [line 121](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/scripts/backfill-managed-mail-r2.ts#L121), [environment schema:106](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/env/src/server.ts#L106).

Batch size and concurrency are optional strings converted with `Number`, without positive-integer validation. `concurrency=0` creates no workers. The outer function still advances the cursor, adds every selected row to its total, and prints completion. The same worker-array construction also accepts values that convert to NaN or a negative length as zero workers.

The focused test imported the real script with one mocked pending row and concurrency `0`. It printed `Backfilled 1 managed mail raw objects to R2` and `Copied 1 row references`, while neither an object copy nor a database update occurred.

Fix by validating finite, positive, bounded integers in `@quieter/env` before creating clients or selecting rows. Count completed copies, rather than selected rows, in the success message. Verify that invalid configuration fails before any client work. Production backfill was not run.

## F108

### P2: The local Worker and Node commands parse the same env file differently

Evidence: [local-doctor.ts:29](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/env/src/local-doctor.ts#L29), [prepare-local-workers.ts:7](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/prepare-local-workers.ts#L7), [prepare-local-workers.ts:23](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/prepare-local-workers.ts#L23), [package.json:26](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/package.json#L26).

`parseEnvFile` manually splits lines and removes enclosing quotes. It does not implement the inline-comment syntax supported by the Node env loader used by local scripts. Worker preparation consumes this parser and serializes its result into bindings.

A dummy fixture `QUIETER_LOCAL_WORKER_TOKEN=abc123 # local-only` parses as `abc123` with Node's `parseEnv`, but as `abc123 # local-only` with `parseEnvFile`. A quoted value followed by a comment retains both quotes and comment in the custom parser. This also affects the linked live-sync secret assembled during Worker preparation.

Impact: a valid annotated env file can produce different credentials in Node-triggered requests and the local Worker, causing authentication or token validation failures. Fix by using `node:util.parseEnv` inside the existing local-doctor boundary and retaining the current nonempty-value filtering and isolation checks. Add one parser-parity test using comments and quoted values. The fixture contained no real secret.

## F109

### P2: Secret refresh serializes dotenv values as JSON strings

Evidence: [local-linked-secrets.ts:44](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/local-linked-secrets.ts#L44), [local-secrets.ts:108](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/local-secrets.ts#L108). The push path uses the same encoding at [line 41](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/local-secrets.ts#L41), but its SST parser was not exercised.

The refresh and pull commands overwrite the entire local env file using `JSON.stringify(value)` as dotenv quoting. Node's dotenv parser is not a JSON string decoder. A dummy value containing a backslash and a double quote failed an exact write/read round trip: backslashes were doubled and the quote terminated the value rather than being JSON-decoded.

Impact: an otherwise valid local secret or configuration value can change when linked secrets are refreshed, including values not themselves supplied by SST. This is independent of F108; replacing the custom reader alone does not repair the writer.

Fix by using quoting that round-trips through the actual env-file parser. Validate the complete serialized result before overwriting the file, and reject an unrepresentable value before writing anything. Test a backslash and a quoted value using dummy data. No existing local env file was read or rewritten by this audit.

## F110

### P2: Catch-all authorization and claim tests survive removal of every SQL predicate

Evidence: [mail-domain-catch-all.test.ts:36](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/mail-domain-catch-all.test.ts#L36), [line 81](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/mail-domain-catch-all.test.ts#L81), [fake-database.ts:50](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/helpers/fake-database.ts#L50), [line 71](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/helpers/fake-database.ts#L71).

The cross-team test enqueues an empty domain result. The competing-holder test enqueues an empty update result. The fake ignores `where`, `set`, and locking, returning queued rows regardless of the query. These tests verify handling of predetermined database outcomes, not the tenant predicate or conditional claim their names imply.

An in-memory Vite transform removed all four `.where(...)` calls from the actual catch-all service. All seven tests still passed. The unmodified seven tests passed too. No tracked source was changed.

Fix by keeping the useful unit tests for result handling and adding a small disposable-database scenario with two teams and an existing catch-all holder. Assert that the foreign domain and current holder remain unchanged. Do not extend the fake into a SQL interpreter or replace these checks with exact SQL-string snapshots. This is a demonstrated test blind spot, not a claim that the current service lacks its predicates.

## F111

### P3: Prefetch tests lock down independent call order and do not test their claimed deduplication

Evidence: [settings-prefetch.test.ts:11](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-prefetch.test.ts#L11), [line 24](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-prefetch.test.ts#L24), [line 30](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-prefetch.test.ts#L30), [settings-prefetch.ts:38](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-prefetch.ts#L38).

The helper replaces `QueryClient.prefetchQuery` with a resolved spy. The mailbox test requires an exact ordered list of calls, although those requests are independently started and awaited together. Reversing just the two requests in memory preserved the requested keys and settling behavior but failed one of the four tests. All four unmodified tests passed.

The separately named deduplication test invokes the helper only once against that spy. No cache or concurrent request deduplication executes.

Fix by comparing the requested key set without order where order has no contract. Either rename the second test to reflect its intent-routing assertion or use a real QueryClient and a mocked query function to test two overlapping requests. Avoid retaining both redundant call counts and the same information in an exact ordered array.

## F112

### P3: Five dependency declarations have no consumer in their owning workspace

Evidence:

| Manifest | Unused declaration |
| --- | --- |
| [packages/orpc/package.json:41](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/package.json#L41) | `@cfworker/json-schema` |
| [packages/orpc/package.json:42](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/package.json#L42) | `@modelcontextprotocol/sdk` |
| [packages/billing/package.json:19](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/package.json#L19) | `@quieter/ai` |
| [packages/aws/package.json:15](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/aws/package.json#L15) | `@aws-sdk/client-sesv2` |
| [package.json:45](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/package.json#L45) | root `fast-xml-parser` |

Knip reported these and the source/import searches confirmed no owning-workspace consumers. The installed `@ai-sdk/mcp` declares only Zod as a peer, so the direct MCP SDK declaration is not needed to satisfy that package. The actual XML parser import belongs to `packages/mail`, which already declares it. SESv2 consumers belong to oRPC, which also declares it.

Impact: the manifests retain misleading package relationships and unnecessary direct dependency maintenance. Removing a declaration does not necessarily remove a transitive installed package or shrink a bundle. Remove these five declarations through `vp`, refresh the lockfile, then run the affected package checks. Keep the valid dependencies in their consuming packages.

## F113

### P3: A complete managed-message deletion implementation is unreachable

Evidence: [deletion.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/deletion.ts#L1), [line 104](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/deletion.ts#L104), [line 139](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/messages/deletion.ts#L139).

This 179-line module implements message/thread deletion, transactions, content revisions, and orphaned-object cleanup. Knip reports the file unused. The repository import graph and symbol searches found no imports, reexports, package export, or test caller for either entry point.

Follow-up export-root verification inspected all 16 workspace manifests and inventoried all 150 export targets across every conditional branch, including exports with no import caller. The 132 tracked source roots were traversed through resolved imports, source reexports, and literal dynamic imports. `deletion.ts` has zero incoming edges, zero direct package exports, and is unreachable from every package export root. The graph artifact now records this evidence explicitly. F113 remains valid; the parent can omit a runtime cleanup finding based on this unused implementation.

Impact: maintainers must distinguish unused deletion behavior from the active mail operations when fixing storage or authorization. Delete the unused module after confirming permanent deletion remains outside the current feature contract. Do not connect it to a router merely to make the unused-code warning disappear. This finding does not claim that runtime deletion currently executes these functions.

## F114

### P3: The unused contour renderer retains 323 lines and a lint exception

Evidence: [contour-lines.tsx:176](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/contour-lines.tsx#L176), [vite.config.ts:181](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/vite.config.ts#L181).

`ContourLines` has no import, dynamic import, registry reference, or render site in the inspected repository. Knip independently reports the file unused. It is not a file-based route or other framework entry. The module still owns a canvas lifecycle and is listed in the broad imperative-lifecycle lint exception.

Remove the file and its obsolete override entry. This removes maintenance surface; it is not evidence of current rendering cost or an existing animation leak. F48 covers the separate Reveal behavior defect.

## F115

### P3: The browser terms-cookie writer has no caller

Evidence: [terms-acceptance.ts:5](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/terms-acceptance.ts#L5), [vite.config.ts:260](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/vite.config.ts#L260).

Knip reports the 13-line browser helper unused. Symbol and import searches confirm no caller for `setTermsAcceptanceCookie`. The server-side terms reader and its tests are separate and remain in use. The root lint config still lists the unused browser file in the cookie API exception.

Remove this orphan helper and its exception, or have the owning auth task explicitly decide whether a product flow needs it. Do not infer from this result alone that terms acceptance is currently recorded or broken; that behavior is outside this tooling finding.

## F116

### P3: Obsolete compose and AI compatibility exports remain after caller migration

Evidence: [gmail-compose.ts:24](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-compose.ts#L24), [line 32](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-compose.ts#L32), [classify-gmail-message.ts:163](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ai/src/classify-gmail-message.ts#L163), [extract-gmail-useful-detail.ts:257](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ai/src/extract-gmail-useful-detail.ts#L257).

`ChatComposeMessage` is used only by the unused `toChatComposeInput` adapter. Live compose proposals use the separate app `toChatComposeMessageInput`. The `classifyGmailMessage` and `extractGmailUsefulDetail` exports are aliases of neutral names, and repository searches found no consumer of either old name. These are private workspace packages.

Remove the unused adapter and its private type, and remove the two obsolete aliases. Retain the live Gmail draft/send functions and neutral AI implementations. This is a concrete cleanup of unreferenced code, not a restatement of F23's contract migration or F35's short-helper preference.

## F117

### P3: PR size label-definition synchronization can never run

Evidence: [pr-size.yml:4](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/pr-size.yml#L4), [line 58](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/pr-size.yml#L58), [line 61](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/.github/workflows/pr-size.yml#L61).

The workflow has only a `pull_request_target` trigger, but its `sync-label-definitions` job requires `github.event_name != 'pull_request_target'`. That job is unreachable under every configured event. Changes to label colors and descriptions in the shared array therefore cannot be synchronized by this workflow.

Give the synchronization job an explicit trusted trigger such as `workflow_dispatch`, or remove the dead job and document the existing owner. Preserve the current separation between untrusted PR sizing and privileged repository maintenance. No label or workflow run was changed.

## F118

### P3: The custom PNG CRC loop duplicates the supported Node builtin

Evidence: [generate-web-assets.ts:166](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/generate-web-assets.ts#L166), [line 175](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/scripts/generate-web-assets.ts#L175). Installed Node declarations document `zlib.crc32` since v22.2.0 at the installed `@types/node/zlib.d.ts:194`; CI provisions Node 24.18.0.

The script builds a 256-entry CRC table and manually computes the checksum for every PNG chunk. A local probe extracted the actual chunk encoder and compared its checksums with `node:zlib.crc32` for IHDR, IDAT, and IEND data. They matched. The local runtime was Node v26.7.0.

Replace the table and bitwise checksum loop with `crc32(contents)`. This is a small, behavior-preserving simplification that removes custom binary arithmetic and its suppressions without adding a dependency.

The broader suggestion to replace this entire PNG encoder with resvg was not established. The script computes procedural RGB pixels and embeds their PNG in an SVG. The installed resvg API renders SVG to PNG and exposes rendered pixels, but has no arbitrary-pixel input encoder. Retain that distinction. Replacing the shader with SVG filters would require visual-equivalence work; adding an image library just to eliminate this compact encoder has not been justified by this audit. No production asset was regenerated.

## F119

### P3: A compiler exception is attached to a hook that does not match its rationale

Evidence: [vite.config.ts:277](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/vite.config.ts#L277), [line 281](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/vite.config.ts#L281), [controller imports:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/message-search/components/message-list-search/use-message-list-search-controller.ts#L1).

The comment says these components create a dynamic Motion element from a caller-selected `as` prop. The override also disables `react/react-compiler` for the entire message-search controller, which imports no Motion API and performs no such component creation. This makes the exception's stated justification inaccurate and exempts unrelated future hook changes.

Remove this path from that exception, or document the actual compiler diagnostic and suppress its narrow source location. A targeted `vp lint ... -D react/react-compiler` invocation returned zero diagnostics. Since configuration precedence may still retain a file override, that result is not claimed as proof that removing the override will pass; verify the corrected configuration during implementation.

Other broad overrides were reviewed but are not findings merely because they are broad. Route declaration ordering, explicit environment bootstraps, imperative canvas cleanup, and intentionally disabled complexity checks have stated rationales. The dead-file exception entries in F114-F115 should disappear with their files. The additional `apps/web/src/env.ts` exception points at a nonexistent path and can be removed with this cleanup.

## F120

### P3: App modules export internal helpers and retain unused small definitions

Evidence: the complete [33-row export triage CSV](unused-exports.csv) records each candidate's exact path, declaration lines, classification, observed consumers, and required preservation or coordinated cleanup. Candidates came from the saved Knip output. The two framework defaults in `apps/web/vite.config.ts` and `apps/web/src/server.ts` were excluded and must remain.

Twenty-two definitions are used internally but have no consumed external export. Examples include [useComposeEditor:114](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-editor.tsx#L114), [sidebarSurfaceVariants:20](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/navigation/components/sidebar-surfaces.tsx#L20), and [SettingsOverviewContent:132](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-overview-panel.tsx#L132). The hook is used by three editor controls, the variants by three local surfaces, and the overview component is rendered within its own module. Deleting these definitions would break live behavior. Remove only their export modifiers. Query-key helpers and constants belong in the same category; preserve their mailbox scope, version, and ordering.

Three more candidates are unused forwarding exports in [preview-personas.ts:13](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/preview-personas.ts#L13). Remove those named reexports, with these distinctions:

- The shared `isPreviewPersona` function remains exported because this module separately imports and calls it under the alias `isPreviewPersonaValue`. Remove only its unused forwarding export.
- The shared `previewPersonas` tuple remains necessary for the local predicate and exported `PreviewPersona` type. Remove the facade forwarding export and then the tuple's own export modifier together.
- The app/shared `previewPersonaCookieName` is used only by its unused forwarding export. Remove that forwarding export and the app/shared definition together. The independently defined, actively used constant in `packages/auth` must remain.

Six small definitions have no live consumer and should be deleted rather than merely made private:

| Definition | Evidence | Preserve |
| --- | --- | --- |
| `emptyComposeFormValues` | [compose-form.ts:15](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/domain/compose-form.ts#L15), no reference beyond declaration | `ComposeFormValues` and live draft/form conversion helpers |
| `getShortcutKeys` | [keyboard-shortcuts.ts:281](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/hotkeys/domain/keyboard-shortcuts.ts#L281), no reference beyond declaration | Shortcut types and definitions |
| `resetManagedDemoMail` | [demo-managed-mail.ts:1141](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/managed-mail/demo-managed-mail.ts#L1141), no caller | Live state initialization and writes |
| `resetLandingDemoMail` | [demo-mail.ts:440](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/demo-mail.ts#L440), no caller | Landing demo state and initialization |
| `getLandingDemoMailboxes` | [demo-mail.ts:741](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/demo-mail.ts#L741), unused 30-line factory | Live demo mailbox listing and landing mailbox ID consumers |
| App/shared `previewPersonaCookieName` | [preview-personas.shared.ts:1](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/preview-personas.shared.ts#L1), only the unused facade reexport references it | Independent auth-package cookie constant |

The remaining two unused definitions are the components in F121-F122. Totals are 25 export removals, including three forwarding exports, and eight definition deletions. No named candidate was established as a consumed public contract requiring its outward export to remain. The private app has no package export map, and the source checks found no wildcard or namespace consumer hiding usage of these candidates. This does not authorize removing unrelated exports from the same files.

Impact: unused outward exports enlarge the apparent module API and encourage coupling to implementation details; dead definitions leave obsolete alternatives beside live code. These are maintenance costs, not measured runtime overhead. Make the small edits identified per row and run the normal type/lint checks. No new behavior tests are needed for export visibility alone. Existing behavior must remain unchanged for the internal-only rows.

Verification: every named app export candidate in the saved Knip results appears exactly once in the CSV. AST parsing confirmed all 33 declarations and their current line ranges. Repository-wide symbol, import, reexport, and namespace searches were checked against the individual modules and tests. No candidate was classified solely because Knip called it unused. This appendix does not claim to cover every app export that Knip did not report.

## F121

### P3: SettingsListRow and its exclusive style variant are dead

Evidence: [settings-layout.tsx:195](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-layout.tsx#L195), [listRow variant:27](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/settings-layout.tsx#L27), CSV row `AE23`.

The 13-line `SettingsListRow` wrapper has no import, source reexport, JSX invocation, or registry reference. The `listRow` style variant is referenced only by this dead wrapper. Other exported settings components and `settingsSurfaceVariants` have active callers, so the file itself is not dead.

Delete the wrapper and its now-unused `listRow` variant. Keep the shared variant factory and all live row components. This removes a redundant UI option and its exclusive CSS recipe without changing the rendered settings layout. The finding is separate from F114's unused contour module and F32's component-size observation.

## F122

### P3: MailboxSettingsRow is an unused wrapper inside the live switcher module

Evidence: [mailbox-switcher.tsx:1064](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/navigation/components/mailbox-switcher.tsx#L1064), [live MailboxSummary:342](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/navigation/components/mailbox-switcher.tsx#L342), CSV row `AE28`.

The 14-line `MailboxSettingsRow` wrapper has no import, source reexport, JSX invocation, or registry reference. It wraps `MailboxSummary` with a trailing action slot, but no current screen uses that wrapper. This is an unused definition, not an internal-only export.

Delete only `MailboxSettingsRow`. `MailboxSummary`, `MailboxSummaryProps`, the action prop, and the switcher module are still used by the live dropdown and must remain. The benefit is removing an obsolete exported UI wrapper; no current rendering cost is claimed.
