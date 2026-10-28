# Final delta review

Reviewed by gpt-6-astra.

No blockers found in the requested source delta at 8d2ff77d298f1419f712328d106c3783b5d95ecb. This verdict covers source correctness and reviewed evidence. Final independent compiled runtime remains pending and is required before the parent arms merge. Full repository checks and tests completed successfully, as verified in the supplied logs.

## Scope

Reviewed commits 93b771777eb0a32e3263bb7cb065e6fd1d50fce0 and 8d2ff77d298f1419f712328d106c3783b5d95ecb, plus the two remaining changed hashes from my first 27-file review. Baseline remains 103e2b6e8453fb0fae1ab69fb4860cb5dd2f9fa9. Twenty-three of those original 27 files remain byte-identical to my recorded hashes. Four changed, and the loader source/test add two files to this review's scope. Documentation currently being finalized is outside this immutable source verdict.

## Findings

- Scroll anchoring now captures from the virtualizer's old model before the row measurement callback returns a new size. I checked the installed @tanstack/virtual-core implementation, which invokes that callback before resizeItem changes its cache. Padding is subtracted when finding the model anchor and added during restoration. The existing identity/index guard prevents restoring onto a different thread after list changes.
- Dirty layout state now survives cancellation and Activity cleanup. Cleanup disarms the current Animation without discarding deferred work or its anchor. A later visible layout pass performs the required reset even if a reversed transition returns to the original width. Old promise continuations are ignored unless they still own the current animation. Cleanup captures the last virtualizer offset before child row refs can reattach ahead of the viewport ref. No detached-component state update or synchronous recursion was introduced.
- Scroll capture updates the pending anchor when actual scroll differs from the virtualizer's already-compensated offset. Installed TanStack Virtual eagerly updates scrollOffset for row-size compensation, supporting the distinction made here. This preserves genuine user movement instead of restoring the transition's initial position. The supplied native-wheel and Activity artifacts exercise the intended browser ordering with a complete stable fixture. Browser/platform diversity remains a runtime limitation.
- The three workspace resources cache only resolved component modules. User, mailbox, form, query and billing data are not cached in them. Each wrapper renders the current props when its module becomes ready. Existing mailbox/session keys remain in place, and effect cleanup prevents an old load from setting state after unmount or Activity cleanup. A later mount can reuse the resolved code without reusing a prior user's state.
- Loading errors are caught in the effect, stored, and thrown during render to the existing error owner. Existing Suspense boundaries remain for child suspension. The public preload helper observes and returns the original rejection-bearing promise; Promise.allSettled prevents an ignored prewarm from becoming an unhandled rejection without converting the consumer's failure into success. The narrow non-async lint exception is justified. The test delays observing each rejected loader through a macrotask and asserts both visible rejection and no unhandled rejection, and the documented negative control fails as intended.
- The mailbox route uses ssr: data-only in apps/web/src/routes/_app/index.tsx. The new effect-owned loading path therefore does not replace server-rendered workspace content or introduce an SSR hydration contract change on the established route. No auth loader, billing query, permission branch or chat mailbox key changed.
- The remaining toolbar drift renames the assistant slot-width constant and removes its redundant comment without changing the slot value or capacity behavior. The showcase drift includes shared workspace gutter/layout composition around its sidebar, beyond formatting alone. It remains confined to the component reference and does not alter product loading or dock state.

## Attention

1. Final source runtime is still pending. The latest supplied release report labels its comparative browser results as source 85c61b15 and explicitly blocks the final verdict on these two corrective commits. The head-final build log and source checks do not substitute for the independent final runtime pass. After the initial review, I inspected final-check.log and final-test.log. Checks report 0 errors and 1 existing TanStack Virtual compiler warning across 1048 files. Tests report 192 files and 1454 tests passed, with 26 files and 278 tests skipped. I did not rerun them.
2. The earlier scroll-anchor coverage gap is now materially addressed in the author's evidence. The corrected fixture uses the actual 15-record paging contract, 27 pages, 393 records and 360 threads. The review read the decision report, native-wheel output and active/settled Activity output. Final release verification must preserve those equal-work guards. Discarded 8-by-50-page reversal runs cannot support a regression or improvement claim.
3. Cold Compose, Snippets and Chat evidence establishes the fallback-retry problem and records development behavior/error ownership checks. Final compiled first-activation comparison for the corrected owner remains pending. Do not present single development observations as measured release speedups or conflate module reveal with ordinary chat billing latency.
4. The updated canonical trail records the release anchor failure, invalid-fixture correction, cold-loading diagnosis and anchor design. Append the final cold-owner choice, both corrective commits and final pass/fail evidence before handoff. Preserve the earlier failed gates and rejected prototype rather than replacing their history.

## Review evidence and limits

Read /tmp/quieter-dock-anchor-fix-1ce5/decision.md, native-wheel.json and activity-unprofiled.json; /tmp/quieter-compose-cold-1ce5/report.md; /tmp/quieter-release-performance-1ce5/report.md, pending-final-verification.md and comparison-calendar-summary.json; and the current canonical decision trail. The reported source85 Calendar comparison is compiled-release evidence. The anchor/cold-owner author's checks are development behavior evidence. Pure algorithm results from the original review remain a separate category.

Prove It Works keeps final compiled runtime pending and records check/test completion only after reading the logs. Explain the Number keeps invalid fixtures, diagnostics and release comparisons distinct. No new agents, source edits, git changes, tests, services, environment changes or external actions were performed. Only this report was written.

## Exact reviewed source

Review timestamp 2026-10-28T01:37:16.902456+00:00.

- `packages/app/src/features/message-list/components/message-list-scroll-pane.tsx` SHA-256 `cefa3c4c524791673eec340daf883b9073d8e73d432fa0b2102db5b606c2f943`.
- `packages/app/src/features/mailbox/components/mailbox-workspace/mailbox-workspace-content.tsx` SHA-256 `01370dd9feb45d0d50bae4e3834a35f2d5174c843a5cd629caee312c7ea80fe0`.
- `packages/app/src/features/mailbox/components/mailbox-workspace/workspace-component-loaders.ts` SHA-256 `29c2ac61a977970dbe8f8141473ba077b44499d082bf12ae722638673d6b8c22`.
- `packages/app/src/features/mailbox/components/mailbox-workspace/workspace-component-loaders.test.ts` SHA-256 `3226171ebc905dfd15551d7714c7b019c053ece0cd3383518d90dd3ca141aec1`.
- `packages/app/src/features/design-system/components/design-system-showcase.tsx` SHA-256 `b967e1998b1ead83e30b448360aca8a214811af94c76b93b7ab5e249ac312cd2`.
- `packages/app/src/features/message-list/components/message-list-selection-toolbar.tsx` SHA-256 `446ed7c2da8ca25023d331f3d52e0f0b554e3b7315feb9be48c1ad191b869713`.
