# Expert review

Reviewed by gpt-6-astra.

No source blockers found in the reviewed working-tree snapshot, including the final document-level lostpointercapture correction. This is a bounded source and evidence review, not a merge approval for a future commit. Final integrated release verification and repository checks remain the parent's shipping gates.

## Correctness review

- The compiled calendar splitter preserves the original strict half-open instant intersection, actual zoned midnight boundaries, fractional seconds, all-day date membership and wall-clock clipping. The changed production caller constructs one splitter per visible range. Recurrence expansion and event metadata remain on the established path. The existing repeated-hour representation can have an end wall minute before the start wall minute; the patch preserves that behavior rather than silently changing elapsed-time semantics.
- Pending time display matches connection, calendar and event identity. It overlays only time-only updates onto current confirmed metadata. Selected-query initialData comes from confirmedEvents. Mutation failure removes the overlay without rollback writes, so a background refresh is not overwritten. The workspace prevents a second event move while the mutation is pending. Broader edits and recurring-event confirmation retain their previous path.
- The pointer ghost and snapped guide are outside React state updates. Cancellation clears frame ownership, marker, source state and capture before any move callback. Keyboard-generated clicks bypass pointer suppression. The final handler at packages/ui/src/components/ui/use-schedule-event-drag.ts:168 listens on document because a detached source's lostpointercapture is delivered there. It checks current capture ownership before canceling. The before/after source-removal artifacts show the prior orphaned ghost and the corrected cleanup without an extra mutation. The next actual click succeeds.
- Manual scrolling reschedules hit testing while the pointer remains stationary. The drag-scroll artifact records a changed snapped target with no pointer move. The timed, all-day and month target artifacts cover the changed hit areas. Touch scrolling remains outside this drag implementation.
- Width invalidation is gated at the common updateRowMeasurements function, covering both callers. Each promise continuation checks the currently owned Animation before flushing. On reversal, a newer transition is discovered instead of blindly flushing an old leg. Unmount cleanup clears ownership. The recursive call is an asynchronous settlement retry, not a synchronous recursive loop. Row measurement remains active. I found no source-level stale-completion or pending-animation loop defect.
- WorkspaceDock owns the shared width and breakpoint contract. The main width changes while the sidebar keeps its full width and translates. Closed slots disable pointer input and are inert. The existing app focus owner remains intact. The mobile inert condition now also requires an actual sidebar element.
- Event presets use event overrides from the selected connection, the fetched provider event palette and the current form value. Arbitrary calendar background colors are confined to the calendar picker or Calendar default. The Google write adapter still resolves explicit overrides through its event palette and rejects unknown colors. No provider boundary or authorization check is weakened.
- Compose's raw-HTML equality and text-first check skip redundant normalization without bypassing external changes. The frozen form defaults are constructor inputs; live form updates still use explicit setters. The new signature node preserves the existing owned wrapper, and the empty leading paragraph keeps initial authoring outside it. The provided actual component evidence covers sender replacement with authored bold content, external saved reset, a new session and exactly one owned signature. No migration attempts to infer ownership of old unmarked text.

## Attention

1. Final compiled-head performance remains pending. /tmp/quieter-release-performance-1ce5/report.md records the compiled baseline only. /tmp/quieter-calendar-render-1ce5/projection-comparison.json is a pure algorithm comparison. Dock, pointer, pending-state and compose artifacts are development-browser behavior evidence. None alone proves final release input latency or physical-device frame rate. Preserve those labels in the PR and finish the planned matched release comparison before claiming the user's performance goal is met.
2. The canonical decision trail stops at decisions.tsv:8. Add append-only rows for the pointer implementation and detached-source correction, pending display ownership, route subscriptions, compose parsing changes, the separately approved signature correction and final validation. The signature fix is a meaningful extra behavior change, even though the supplied baseline reproduction and final proof justify it. The broad coverage report documents these decisions, but they are absent from the canonical log.
3. Evidence pointers in decisions.tsv:2 and :4 are weaker than the later artifact pointers. The first says Current user messages and an old branch name. The second points to the plan rather than the user instruction. I verified the scope against the matching workspace transcript at /root/.codex/sessions/2026/10/27/rollout-2026-10-27T21-39-35-01a17f4d-ec37-70f2-be30-006b3fd4e412.jsonl, user records 3307, 3357, 3387, 3415 and 3470. A final log row should preserve that concrete authorization evidence and the final branch/commit.
4. Scroll-anchor evidence is narrow. /tmp/quieter-dock-implementation-1ce5/views-part1.json verifies one demo thread at one offset. The design judgment also asked for rows whose heights change while narrowing, breakpoint changes, Activity return and reversal lifecycle coverage. I found reversal/settled-animation, mobile and reduced-motion evidence, but not a convincing large/wrapping-list anchor case in the supplied artifacts. Record this limitation or cover it in the final runtime pass. This is a coverage gap, not an identified source bug.
5. The all-app audit is a documented representative pass across 41 modules, not complete runtime coverage of every app state. The coverage TSV correctly calls out real AI streaming, long transcripts, large production inboxes, physical trackpad behavior, browser diversity and provider writes as untested. Keep those limits visible. No production credential, cache-isolation or analytics regression was introduced in the reviewed diff.

## Evidence and limits

I read the pstack entry, native adapter, no-comments role, show-me-your-work, unslop, Prove It Works, Explain the Number and benchmark checklist. Prove It Works kept final release status pending. Explain the Number kept helper timings, DEV observations and compiled baseline results distinct. Comment review found no correctness or security suppression requiring a blocker; I made no stylistic edit requests.

I read the supplied decision trail, playbook, design judgment, app audit and coverage TSV, calendar render and polish reports, release baseline report, dock geometry and view artifacts, pointer/target/no-op/manual-scroll artifacts, source-removal script and before/after results, projection output and signature proof. Transcript access was restricted by first-record cwd metadata to this workspace; the cited parent session supplied the scope check. I did not rerun browsers or tests, inspect unrelated chats, alter source/git/services/environment, or use external applications. The only file written is this review.

The following exact working files were reviewed against baseline 103e2b6e8453fb0fae1ab69fb4860cb5dd2f9fa9. New untracked source and tests are included. SHA-256 identifies the reviewed content; subsequent edits need their own delta review.

Review timestamp 2026-10-28T00:35:23.370103+00:00.

- `packages/app/src/features/calendar/components/calendar-event-editor.tsx` SHA-256 `e0dc792343afbf495e52be42663b21838883f597e8049cb5d55a4177e306a05e`.
- `packages/app/src/features/calendar/components/calendar-sidebar.tsx` SHA-256 `32d06d00419c7f2c166baf8e1633be547f294438a735e60ff9115a18b7cc148c`.
- `packages/app/src/features/calendar/components/calendar-workspace.tsx` SHA-256 `0be1eee624835d7b685960fb8f09c0bfc077b19d449f4f56e711e62565ddc08a`.
- `packages/app/src/features/calendar/components/use-calendar-data.ts` SHA-256 `41ae1a8a7c924e173632de5173df3a852cdd154c82ab34886be9412d434817db`.
- `packages/app/src/features/calendar/domain/calendar-schedule.ts` SHA-256 `7a0745ecda02562c85196abfc6481f92ffb0e22d3b1bc6074ed87ef42d71156d`.
- `packages/app/src/features/chat/components/assistant-sidebar.tsx` SHA-256 `432a0b0a4d7a8b4fc531f519009d7d7875aa48132d9fedb2ed7e2f584d38accd`.
- `packages/app/src/features/chat/components/chat-view.tsx` SHA-256 `5331f52f8a06f28ca2e46485719f9624b8b41f31313eea8edc48c09eb440170a`.
- `packages/app/src/features/compose/components/compose-editor.tsx` SHA-256 `73e202d6caa60c127630e7e1080e3bdbac63c07f3f8a8cb3af61a18cc10b437b`.
- `packages/app/src/features/compose/components/compose-workspace.tsx` SHA-256 `a81b7f7ddae0a7b689c2716a4470f915c11ce6faa2e30c12dc03c0b76d9436f3`.
- `packages/app/src/features/compose/components/use-compose-dialog-controller.ts` SHA-256 `82efc8fd4a6e0367ce493d4c0040d22bb7dcedc0aa74461cd298d1a9093fea8e`.
- `packages/app/src/features/compose/domain/draft.ts` SHA-256 `436afdfd186a23f42167a67a979057b15ad99ca4973dc132f4d987d1f1bc9f8b`.
- `packages/app/src/features/design-system/components/design-system-showcase.tsx` SHA-256 `a9b0e0de2f47974cdb95dd68544b4dad393397479dc50bd0712c20fb6ba7b212`.
- `packages/app/src/features/mailbox/components/mailbox-workspace.tsx` SHA-256 `eb019e30fce7ae54be45a32e4be5b4bdceca5403d39276450188969f2f4c8303`.
- `packages/app/src/features/mailbox/components/mailbox-workspace/mailbox-workspace-content.tsx` SHA-256 `9d541251eb02f06d13c6efe267a700614d2c764009de82f6e43f1e8806bff365`.
- `packages/app/src/features/mailbox/components/mailbox-workspace/use-mailbox-route-search.ts` SHA-256 `91775bc35ea9ad347d7f1e4043ca2b011b5d838871b47c444cd16ba603476f87`.
- `packages/app/src/features/message-list/components/message-list-scroll-pane.tsx` SHA-256 `a3e8938d3268818fac0d6a428de58c127f1c26964eaca205a092724e96496d3d`.
- `packages/app/src/features/message-list/components/message-list-selection-toolbar.tsx` SHA-256 `94d87468f57dc933a1757a4105ae80c746d7a104e1397deb1ab1dfe803fd7dcb`.
- `packages/app/src/features/navigation/components/sidebar-label-nav.tsx` SHA-256 `7b95a22ac8e1f1de7bc7c1d0b0495467d3fcdeaf275e1f8699991c0211c5ce44`.
- `packages/calendar/src/time.test.ts` SHA-256 `8858eda542866fc1fecaf3ea8aa9a7f59619715568b0c1cd3a21b1fd726ffee4`.
- `packages/calendar/src/time.ts` SHA-256 `a2f87d5f129b1e353ae6193a9b9d43720bfbf5e03c74167a3222a180ea91c550`.
- `packages/ui/package.json` SHA-256 `f5b6d7f30034680fad6e7ad7e0e726cf7412d1f6a77f1bfc36be0ca79f89d45e`.
- `packages/ui/src/components/ui/autocomplete.tsx` SHA-256 `0cc2a4ab3b4f9f566a58662eec9b7e0ed0358be99a49c14baf58d235f8cf3bc0`.
- `packages/ui/src/components/ui/schedule.tsx` SHA-256 `fd1f2a8f2dcffd70aa5d776c664ed2d8827a6d8279c46f02f4368dc8c72b1503`.
- `packages/app/src/features/calendar/domain/calendar-mutation.test.ts` SHA-256 `b8bd38b5de29035d3e5a2a21753716a0cb9ba5fb9695402e11f1d7544a1ff42e`.
- `packages/app/src/features/calendar/domain/calendar-mutation.ts` SHA-256 `6548ec82c6d5a7d11080a04fb1bff012fefaf5ae678f7116fdf5750026e1c8ff`.
- `packages/ui/src/components/ui/use-schedule-event-drag.ts` SHA-256 `54c184b2abe24cbb65eab3f8d64cb0a4c17d50981602208d5b67a2f6a6051880`.
- `packages/ui/src/components/ui/workspace-dock.tsx` SHA-256 `685306145e26c1e91f77dee72216ae42c7c6c10c5fd2f9b4950f38fd0b1177a9`.
