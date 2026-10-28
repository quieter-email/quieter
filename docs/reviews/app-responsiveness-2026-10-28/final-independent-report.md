# Independent compiled-app verification

PASS+NOTES for application source `978a603164a77243066fac9a0e67661497a9bbc7`. The verifier wrote no application code. The final compiled app passes the behavior checks below. The remaining dense-mail settling cost is explicit and prevents a universal smoothness or device-FPS claim.

## Runtime and isolation

The comparison uses local compiled production React builds in Chromium 156, without React DevTools. The baseline is `103e2b6e8453fb0fae1ab69fb4860cb5dd2f9fa9` on port 3037. The final source runs on port 3044. Both use the supported site gate and Gmail preview persona. Approved development configuration passed `vp run env:doctor`. Client and local Worker builds passed through Vite+.

All mail and calendar workloads use complete synthetic preview records. Provider writes, production resources, AI requests, and fabricated billing credits are absent. The assistant retains its ordinary plan restriction. The separate warm-plan experiment reuses the complete actual development billing response in the normal billing query cache.

Reported timing runs use actual input, no CPU profiler, equal work assertions, and five alternating runs per side. The eight-core host was quiet after other authors stopped their services. Diagnostic CPU profiles and DOM getter counters run separately. Timing ends at a selected attribute or ready editor commit, with the next paint opportunity reported separately. These are browser timestamps, not measured physical display frames.

## Measured changes

The following calendar results compare the baseline with source `85c61b154fc0e6588512eaeba5dcb750ac22d054`. Later source commits do not change Calendar code. Final source 978 receives fresh Calendar behavior checks below.

| Scenario | Baseline median and range | Changed median and range |
| --- | --- | --- |
| Eleven-event week, click to selection commit | 56.9 ms, 51.5 to 73.4 | 32.8 ms, 28.9 to 36.4 |
| Five-hundred-event month, click to selection commit | 1808.3 ms, 1732.4 to 1827.4 | 39.1 ms, 36.8 to 44.3 |

The dense month renders the same 126 capped event cards on both sides. The original main-thread stall includes repeated month projection work. Separate old and new projection checks preserve complete output while removing repeated zoned-day-boundary calculations. The calendar rendering audit records the separate algorithm evidence in `/tmp/quieter-calendar-render-1ce5/findings.md` and `projection-comparison.json`. Every click changes the selected event and all clicks complete. Baseline retained observers duplicate some raw long-task entries. The summary deduplicates exact start and duration pairs. The claim uses selection-commit latency rather than inflated task counts. `comparison-calendar-summary.json` contains the results.

First-reveal results compare the baseline with source `8d2ff77d298f1419f712328d106c3783b5d95ecb`. Each run starts a fresh document with HTTP cache warm. Compose and Snippets retain the same dense Calendar and complete mail caches. The assistant experiment retains the complete mail cache and warms the actual plan response. The later Enter guard, main stacking context, and row measurement changes do not alter the shared module loader. Final source 978 receives fresh loading and keyboard checks below.

| First activation | Baseline median and range | Changed median and range |
| --- | --- | --- |
| Empty Compose, editor ready | 372.7 ms, 364.8 to 388.2 | 98.0 ms, 95.8 to 132.0 |
| Snippets, search ready | 335.2 ms, 334.1 to 344.6 | 48.4 ms, 46.9 to 75.0 |
| Assistant, code ready with actual plan query already warm | 338.5 ms, 329.1 to 344.7 | 100.7 ms, 80.2 to 145.6 |

Compose next-paint medians are 944.1 to 99.6 ms. Snippets next-paint medians are 911.0 to 49.1 ms. Fresh Compose has an empty body, empty recipient and subject fields, no signature, and no quoted content. The first real focused text input reaches the editor. An ordinary assistant activation with a real plan fetch takes 509 to 294 ms in one separate sample. Plan-fetch time remains part of the ordinary path.

A separate production CPU and resource trace maps the former code-reveal wait to React's roughly 300 ms Suspense fallback throttle. The cached Compose chunk completes in about 11 ms, followed later by the throttled commit and about 52 ms of editor and DOM work. The shared loader removes the code-reveal wait through supported state ownership. `comparison-first-reveal-summary.json` contains the repeated results. Raw diagnostic profiles remain separate from timing evidence.

Five alternating typing runs per side verify actual keystrokes in an empty body and a 21 KB body. Redundant DOMParser calls fall from 25 or 26 per five-key recording window to zero. Exact text and focus remain correct. Latency ranges overlap, so this evidence supports less redundant work, not a general typing-latency speedup. `comparison-typing.json` contains the raw observations.

## Final dense-mail limitation

The final row change reduces DOM reads but has no measured elapsed-time win. The matched compiled comparison uses source `bf7d31c77ebc33b69f926b30a17b310518b19002` on 3038 and final source 978 on 3044. Both have the same canonical complete list hash, 27 pages, 393 inbox records, 360 threads, 426 source messages, 196 attachment-bearing messages, viewport, theme, layout, selection, and scroll anchor.

Five alternating native open and close pairs per side yield a pooled post-motion maximum-task median of 80.5 to 81.5 ms. The ranges are 0 to 99 ms and 70 to 94 ms. Opening medians are 72 to 80 ms. Closing medians are 85 to 83 ms. This result is inconclusive. A roughly 80 to 100 ms settling burst remains in the dense one-panel stress workload.

A separate instrumented count verifies fewer viewport `clientWidth` reads, 174 and 195 to 28 and 26 for opening and closing. Virtual-row `offsetHeight` reads fall from 505 and 634 to 41 and 135. Instrumentation is removed before elapsed comparisons. The retained change reuses TanStack's public measurement helper and cached sizes. `comparison-settle-summary.json` and `comparison-settle-release-reads.json` keep the timing and work-count evidence separate. The measured duration does not support a settling-latency improvement claim.

## Final source behavior

The final compiled source passes all eight desktop workspace views. The assistant keeps a fixed width while its position and the main panel width have intermediate values. Views include one-panel mail, two-panel mail, both detail layouts, Compose, Snippets, Calendar, and the Calendar editor. Compose subject, body, and DOM range survive both toggles. The dense mail anchor and row selection survive settled toggles. The matrix records 12 to 16 distinct main widths in ordinary desktop transitions. Sampling geometry establishes interpolation, not physical FPS.

The mail fixture follows the established 15-record page contract. It seeds the supported version-6 demo source and mailbox-scoped query and detail caches. Complete nested messages retain attachment, avatar, unread, importance, label, and unsubscribe metadata. Actual shared row heights change between 48 and 68 px at the existing container breakpoint. At a fixed width the current product layout uses uniform heights. No artificial row-height CSS is added.

Five four-leg rapid reversals preserve thread 150 and its exact 17 px offset, with selection and all loaded query work unchanged. Four Activity cases preserve the same state when a view hides, the dock changes while hidden, or the view returns during a transition. Trusted wheel input during opening and closing takes precedence over the saved anchor. Final boundary probes around the existing row breakpoint preserve state. `candidate-inbox-reversal-unprofiled.json`, `candidate-final-inbox-activity.json`, `candidate-final-inbox-user-wheel.json`, and `candidate-row-boundaries.json` contain the checks.

At 390 px, the Calendar assistant covers the full viewport width. Main content is inert, keyboard focus remains in the assistant or browser chrome, Escape restores a visible logical launcher, and Calendar sticky headers remain behind the assistant. Reduced motion changes geometry without intermediate motion while retaining mail anchor and selection. The desktop Event color popup remains outside both stacking contexts and receives pointer hit-testing. Screenshots were inspected.

Native keyboard checks preserve body Enter, focused-row Enter, J and K navigation, row selection, checkbox Space behavior, and Calendar link activation. Enter on focused Compose, Snippets, and assistant controls activates the control. Direct Compose and Snippets routes accept actual text. Persisted-open assistant loading preserves the real plan restriction. All six fresh-document loading cases record zero errors and zero unhandled rejections. Independent final-source fault injection also fails the compiled Compose and Snippets modules after real hover prewarm. Both active failures show the existing retry and Back to inbox controls, recover to Inbox, and record zero unhandled rejections. Holding Compose while switching to Snippets, then releasing Compose, leaves Snippets active with no stale composer. `candidate-loader-failure-race.json` contains these three checks.

The final 500-event Calendar passes trusted native drag preview, Escape, same-slot no-op, lost capture, outside drop, local preview drop, and immediate pending time display. Confirmed output matches pending output. A wheel gesture during a held drag keeps the preview and cancels without another mutation. Six native wheel inputs reach the actual Week viewport and move it by the requested 120 px each time. The final main document's before-JavaScript error and unhandled-rejection counters remain zero.

Imported event and current-calendar colors, the C130 location option, and the unclipped mini calendar in light and dark themes passed earlier compiled checks at source 85. Their code is unchanged in later source commits. The location popup has one 32 px option in 40 px total height. All 42 mini-calendar buttons lie inside their clipping ancestors. Sanitized screenshots and the polish JSON retain the evidence.

## Evidence corrections and limits

The first wheel attempt used a CLI that dispatched at 0,0 and delivered no Calendar wheel event. That attempt is discarded. Final native inputs use owned CDP with actual viewport coordinates and verify both delivery and scroll movement.

Earlier mail fixtures used eight 50-record pages. Recovery refetch follows the established 15-record contract and truncated those cache pages. Identity-loss runs with changed work are discarded. The real stable-work 17 to 37 px anchor defect was reproduced and fixed. Final checks assert the complete 27-page query before and after each action.

The final report supports the examined local workloads. It does not certify every app path, provider latency, every user's inbox shape, mobile hardware FPS, or uninterrupted scrolling under every concurrent workload. The remaining dense-mail settling cost stays visible in the verdict.

Explain the Number required release builds, equal-work checks, alternating runs, and separate diagnostic instrumentation. Prove It Works changed the gate to actual compiled input and state checks. GitHub CLI is the Shipping fallback because Origin is unavailable. Posting the exact PR verdict waits for the final docs-only SHA and a source/build-invariance check.
