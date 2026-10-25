# Product visual refinement

- [x] Read the Principles section of the poteto-mode skill.
- [x] Phase A: Frame
- [x] Phase B: Design the workflow
- [ ] Phase C: Run the loop
- [ ] Capture the existing product using the established preview personas.
- [ ] Refine shared typography, geometry, semantic contrast, and icon treatment.
- [ ] Apply the same hierarchy to product navigation, mail, compose, chat, and settings.
- [ ] Capture matching light, dark, and narrow screenshots and inspect real interactions.
- [ ] Phase D: Keep the audit trail
- [ ] Phase E: Verify and hand back
- [ ] Commit, synchronize with main, push, and open a PR with the visual comparisons.

The change is complete when the shared visual system addresses all five reported concerns, representative product screens render without clipping in light, dark, and narrow layouts, keyboard and overlay interactions still work, relevant checks pass, and the PR contains matched screenshots with synthetic content.

The work changes presentation in `packages/ui` and the shared web and desktop product in `packages/app`. It includes the web font loader and a regression check of public pages. Existing marketing artwork and home layouts remain separate. No mail, identity, billing, database schema, or provider behavior is redesigned.

The work uses broad visual verification because shared defaults affect every consumer. It does not add tests that freeze visual values. The screenshot recipe and decision log make the pass reproducible. Read-only pstack explorers cover shared styling and preview flows before implementation. One writer owns the changes.

Throughput checkpoint. Capture the baseline first, then verify shared changes in the component gallery before proceeding to product-specific hierarchy. Reuse shared recipes wherever the same treatment appears. Investigate any setup blocker before adding a replacement preview path.
