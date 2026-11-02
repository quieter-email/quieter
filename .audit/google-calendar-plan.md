# Calendar integration run

## Pstack workflow

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back.

## Done predicate

An authenticated user can connect their Google Calendar independently of identity and mail, browse their calendars in day, week, month and agenda views, create and edit timed, all-day and recurring events, manage invitations, move events, and delete an occurrence or series. The agent can inspect the user's schedule and propose calendar changes through the existing approval workflow. Mail invitations remain connected to this calendar. Provider changes appear after refresh and focus. Unauthorized users cannot read or change another user's calendars. The responsive workspace follows quieter's shared controls and the supplied three-panel reference.

## Units and gates

1. Ground. Read-only exploration of OAuth, agent actions, and workspace UI. Record the existing behavior and provider API requirements.
2. Sketch. Compare two independent architecture candidates. Choose a provider-neutral contract and isolate writers by package or feature directory.
3. Agree. Proceed with the synthesized design under the user's authorization. Keep production migrations, deploys, and real invitation sends outside this run.
4. Implement. Build the provider contract and safe server adapter first, then the authenticated router, then workspace and agent integrations. Verify each seam with focused behavioral checks.
5. Scrap. Revisit the shape if implementation repeatedly requires casts or duplicated ownership rules.
6. Verify and hand back. Run the required checks for this substantial behavior change, inspect the real UI in light, dark and narrow layouts, review authorization, and open a PR with screenshots and operational instructions.

## Parallel work

Read-only explorers cover OAuth, agent, and UI seams. Implementation delegates receive exclusive file ownership after the contract is chosen. The primary agent owns root wiring, documentation, final verification, and git operations.

## Rigor and limits

High rigor for credentials, account isolation, external writes, recurrence and timezone handling. Use mocked provider boundaries for destructive/invitation tests and sample browser data. Real account consent requires the account owner. Existing development resources are reused without provisioning or production changes.

## Throughput checkpoint

Complete and verify the server contract before consuming it in parallel. If provider consent prevents live tests, finish local behavior and explicitly report that live authorization remains unverified.

## Verification record

- `vp check --fix`: passed with zero errors and three existing React warnings in unchanged navigation, compose, and message-list components. Generated SST provider types were installed locally with `vp exec sst install --stage local-calendar`; no deployment ran.
- `vp test --maxWorkers 2`: 1,083 passed, 97 skipped. Tests requiring optional external resources remain skipped.
- Final review fixes: 45 tests passed across Calendar authorization, provider transport, OAuth, local write isolation, and cache lifecycle. Formatting, lint, and type checks passed for the nine changed source/test files.
- `vp run check:boundaries`, `vp run check:bundles`, and `vp run @quieter/web#build`: passed. Existing bundler warnings about billing imports and browser-externalized observability modules remain.
- `vp run env:doctor`: passed. The local server used port 3011; only this task's process is stopped after verification.
- Browser preview: day, week, month, agenda, light, dark, and a 390 pixel viewport inspected. The narrow grid scrolls within its panel without page overflow. Editing, creating, deleting, dragging, and keyboard resizing were exercised with preview events. Back to Mail preserved a draft's subject and body. The assistant remained available.
- Screenshots in `docs/screenshots/calendar` contain sample events and a sample account.
- PlanetScale MCP access was verified. Existing development connector-query metadata is recorded in `.audit/google-calendar-query-review.json`; no production records or provider credentials were read for that review.
- Independent reviews found and verified fixes for sparse edits, recurrence parameters, repeated-hour edits, continuation drags, concurrent persistence, quota error classification, and local calendar target isolation. A distinct available model reviewed the final decision trail; no cross-family review is claimed.
- Real Google OAuth consent, provider writes, guest notifications, and real AI calls remain untested. Dedicated-account acceptance is documented in `docs/calendar.md`.

## Principles that changed implementation choices

- Type System Discipline kept provider payload parsing and event-time variants explicit at the package boundary.
- Model the Domain kept user, connection, calendar, event, and date window identities in the cache and mutation contracts.
- Make Operations Idempotent led to stable create-operation identities and conflict checks.
- Prove It Works led to real browser interactions and IndexedDB restart tests, including the mobile scroll fix.

Published for review in [PR #406](https://github.com/quieter-email/quieter/pull/406). Current main was merged before publication, and its 22 release-verification tests passed.

## Landing and shared memory integration

- [x] Reconcile main's Important, retained-mail and shared-memory changes without restoring the retired primary-only Calendar API.
- [x] Preserve main's Calendar read semantics with migrated ownership, cancellation, pagination, time and availability tests.
- [x] Connect Calendar chat to scheduling-focused recall in the shared user profile, retaining chat instruction eligibility, explicit attachments, chat learning and explicit memory changes.
- [x] Keep passive hidden Mail selection out of Calendar recall and keep live availability separate from stored preferences.
- [x] Fix assistant navigation to an event in a hidden calendar after switching from Mail.
- [x] Verify the combined source. Full suite passed 1,184 tests with 278 optional tests skipped. All 18 affected chat integration tests passed against an isolated loopback PostgreSQL container after committed migration checks. Full lint/type check found only two new test lint issues, both corrected and verified with a targeted check, plus the same three pre-existing React warnings.
- [ ] Complete independent parent/head browser verification and final verdict.
- [ ] Push the reconciled head, wait for required CI, squash merge PR #406 and read back its merged state into main.

Calendar does not learn directly from provider event payloads or event-form edits. The current capture contract supports chat and mail evidence. Conversational scheduling preferences already enter that canonical chat workflow; a future Calendar evidence adapter needs its own validated source kind and personal billing route.

The first reconciled head, `8dddbfa6`, passed every required CI check and independent browser verification with notes. Parent Mail hydration was limited by shared-host memory pressure; final-head flows passed with synthetic data. A subsequent review identified direct invitation navigation into a hidden calendar and a month overflow dialog covering selected event details. Both use the existing Calendar visibility/selection flow after correction; focused browser verification and current-head CI must cover those corrections before landing.
