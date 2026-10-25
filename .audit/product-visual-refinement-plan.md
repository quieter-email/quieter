# Product visual refinement

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [x] Phase C: Run the loop
- [x] Capture the existing product using the established preview personas.
- [x] Refine shared typography, geometry, semantic contrast, and icon treatment.
- [x] Apply the same hierarchy to product navigation, mail, compose, chat, and settings.
- [x] Capture matching light, dark, and narrow screenshots and inspect real interactions.
- [x] Phase D: Keep the audit trail
- [x] Phase E: Verify and hand back
- [x] Commit, synchronize with main, push, and open a PR with the visual comparisons.

The change is complete when the shared visual system addresses all five reported concerns, representative product screens render without clipping in light, dark, and narrow layouts, keyboard and overlay interactions still work, relevant checks pass, and the PR contains matched screenshots with synthetic content.

The work changes presentation in `packages/ui` and the shared web and desktop product in `packages/app`. It includes the web font loader and a regression check of public pages. Existing marketing artwork and home layouts remain separate. No mail, identity, billing, database schema, or provider behavior is redesigned.

The work uses broad visual verification because shared defaults affect every consumer. It does not add tests that freeze visual values. The screenshot recipe and decision log make the pass reproducible. Read-only pstack explorers cover shared styling and preview flows before implementation. One writer owns the changes.

Throughput checkpoint. Capture the baseline first, then verify shared changes in the component gallery before proceeding to product-specific hierarchy. Reuse shared recipes wherever the same treatment appears. Investigate any setup blocker before adding a replacement preview path.

## Follow-up preferences and layout

- [x] Simplify typography with smaller, consistent type and single-line title truncation.
- [x] Restore the original desktop/control radius values and corner shaping.
- [x] Remove the single mobile workspace's outer frame and gutter through the shared recipe.
- [x] Ground the existing device preferences, mailbox routing, unified inbox, and row virtualization paths.
- [x] Sketch two mail-layout designs and choose the smaller complete contract.
- [x] Add a remembered Mail layout preference with two panels as the default.
- [x] Reuse the existing list/detail paths for a full-width one-panel mode, including Back, keyboard, and browser history.
- [x] Make rows shorter and horizontal when the list has enough width, retaining metadata and selection behavior.
- [x] Consolidate row presentation, headings, composer actions, search fields, setup frames, and copy controls in shared components.
- [x] Keep the golden importance accent visible over selected row backgrounds.
- [x] Keep unsubscribe confirmation present and make the importance icon reflect its saved state.
- [ ] Verify both layouts, both inbox paths, narrow screens, and resizing; refresh review images and publish the PR update.

Throughput checkpoint. Ground persistence and both mailbox paths before implementation. Geometry and typography are complete; one writer now owns the mail-layout source changes so row and visibility decisions stay coherent. Read-only architecture candidates write separate scratch artifacts. The lead owns browser verification, screenshots, and publication. The existing list controllers, provider adapters, route state, and enrichment remain the source of mail behavior.
