# Local template sync verification

The `quieter` CLI and open template editor were exercised against the local app and the guarded `quieter_dev` database with a synthetic user, team, and scoped keys. No production resource, SDK publication, campaign queue, or real email send was used.

## Automated checks

- `vp check --fix` completed with zero errors and the existing React Compiler warning for `useVirtualizer`.
- `vp test --maxWorkers=2` passed 1,932 tests. The 422 opt-in tests remained skipped.
- Import boundaries and the AWS and Cloudflare handler bundle checks passed.
- `vp run quieter#build` and `vp pm pack` produced the browser SDK, optional React entry, and executable Node CLI.
- A separate consumer installed the tarball with automatic peer installation disabled and strict peer checks. Core imports, CLI help, and initialization worked without React. React Email rendering worked after installing the documented React peers.

Current main was merged after the feature checks. Its landing-page update was preserved. Import boundaries and the affected app lint/type checks passed after that merge.

The [sync behavior tests](../../../packages/sdk/tests/template-sync.test.ts) cover identity, metadata, explicit text, interrupted create/update recovery, conflicts, archives, key rotation, target isolation, lost state, inherited property names, and concurrent ownership. The [source tests](../../../packages/sdk/tests/template-project.test.ts) exercise actual React Email rendering and transitive import reload. The [draft tests](../../../packages/app/src/features/broadcasts/components/template-editor-draft.test.ts) cover incoming versions, dirty drafts, and save races.

## Live API and terminal checks

The installed consumer's `init`, `push`, and `dev` commands created a styled React Email template with manifest props and updated its name, subject, HTML, and plain text through the real scoped template service. Editing an existing shared helper changed the same saved template. Rotating the development key preserved its template binding. Read-only writes and write-only reads returned HTTP 403.

The live run exposed the authentication library's stored daily request allowance. New team keys now use a bounded per-minute window. Existing keys keep their stored settings and can rotate. The exhausted development key returned HTTP 429 with `Retry-After` after the auth response correction.

A transport probe injected HTTP 429 before session opening, a timeout before session opening, and a timeout after the server committed creation. The installed watcher recovered without another source edit. Exactly one matching remote template existed. The [captured terminal output](transport-recovery.log) and [observed result](transport-recovery.json) preserve this evidence.

## Browser checks

The final browser results are recorded in [browser-results.json](browser-results.json). Screenshots use synthetic content and team data.

The open editor adopted clean incoming code, name, and subject changes. An incoming version preserved a dirty browser name and HTML draft, displayed the conflict notice, and disabled stale saving. Offline polling kept the draft mounted. Canceling reload kept the draft. Confirming reload adopted the latest saved code. Desktop and 390px layouts were inspected in light and dark modes.

The development fixtures were removed in a guarded transaction after the checks. Their user, team, template, creation-receipt, and API-key counts were verified as zero. Only this run's synthetic identifiers were eligible for cleanup.

## Delivery limits

The CLI requires Node.js 22 or later. Terminal, package, and browser checks ran on Linux with Node.js 26.11.1. Other operating systems and Node.js 22 were not directly exercised.

Only one local command owns a project's journal. A forced termination can leave a lock that requires confirming owner exit before removing the lock. The journal must be retained for pending-write recovery. Shared imports must sit under the manifest's project directory to trigger watching.

Deploy the updated API before publishing SDK version 0.0.3 through the protected release workflow. The published registry version remained 0.0.2 during this run. No publication or deployment was performed.

The app's startup cleanup removed the initial checkout during validation. All 31 changed files were recovered from snapshot `b0233697b8c674f14c3184f55ff9a7b951449f51` and verified against their saved Git blobs. Verification resumed in the managed checkout attached to this chat.
