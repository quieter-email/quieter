# Implementation plans

## QUIETER-108 — motion consistency

Implements the main-app motion consistency pass from commit `96e4ceb2`.

| #   | Plan                                         | Severity | Status |
| --- | -------------------------------------------- | -------- | ------ |
| 001 | Establish the app motion vocabulary          | HIGH     | DONE   |
| 002 | Make the sidebar entrance meaningful once    | HIGH     | DONE   |
| 003 | Polish mailbox switcher states and entrances | HIGH     | DONE   |
| 004 | Align mail list and message motion           | HIGH     | DONE   |
| 005 | Align chat semantic motion                   | HIGH     | DONE   |

### Recommended execution order

1. `001` establishes values and reduced-motion semantics.
2. `002` and `003` consume those values for navigation and mailbox switching.
3. `004` applies the vocabulary to mail list/detail while preserving virtual-list behavior.
4. `005` applies the vocabulary to semantic chat state while preserving streaming behavior.
5. Run the specialized animation review across the complete diff, then React Doctor and the full
   repository verification workflow.

### Dependencies

- Plans `002`–`005` depend on `001`.
- `003` reuses navigation surfaces refined by `002`.
- `004` and `005` are otherwise independent.

## QUIETER-120 — visual consistency

Implements the frontend design pass. The landing page stays the visual north star; the product
becomes its quiet operational counterpart under one shared vocabulary.

| #   | Plan                                          | Severity | Status |
| --- | --------------------------------------------- | -------- | ------ |
| 006 | Close the verified frontend defects           | HIGH     | DONE    |
| 007 | Complete the semantic token vocabulary        | HIGH     | DONE    |
| 008 | Consolidate shared surface and row primitives | HIGH     | PARTIAL |
| 009 | Give Compose a writing measure                | HIGH     | DONE    |
| 010 | Anchor Chat to the product shell              | HIGH     | DONE    |
| 011 | Standardize the Settings controls             | MEDIUM   | DONE    |
| 012 | Bring Auth into the landing page's voice      | MEDIUM   | PARTIAL |
| 013 | Enforce the system                            | HIGH     | PARTIAL |

`008` is partial: `MobileHeader` landed; the `settingsSurfaceVariants` reduction is deferred because
it changes layout, and Settings' structure is deliberately being kept.
`012` is partial: visible labels and typographic ellipses landed; the atmosphere reduction is open.
`013` is partial: the `/design-system` showcase landed; visual regression coverage and a lint rule
for raw Tailwind palette colors are open.

### Scope authorization

**This series is an authorized redesign.** The AGENTS.md style rule "For incremental UI refinements,
preserve existing layout, density, and hierarchy unless asked to redesign" does not bind work carried
out under plans `009`–`012`. Layout, density, and hierarchy changes are in scope for those surfaces
where the plan calls for them.

Every other AGENTS.md rule still holds without exception. In particular: named theme colors only and
no arbitrary bracketed color values, shared primitives through `@quieter/ui`, no native `<select>`,
no provider or infrastructure terms in user-facing copy, and the cleanest minimal shape with obsolete
paths removed in the same change.

The authorization is per surface, not global:

| Surface                     | Treatment  | Preserve-layout rule |
| --------------------------- | ---------- | -------------------- |
| Landing page                | Refinement | Still binds          |
| Mail list and message detail| Refinement | Still binds          |
| Compose                     | Redesign   | Lifted               |
| Chat                        | Redesign   | Lifted               |
| Settings detail             | Redesign   | Lifted               |
| Auth                        | Redesign   | Lifted               |

The landing page and Mail are explicitly excluded because their current density, keyboard model, and
composition are strengths. Changes there are corrections, not reinterpretations.

### Recommended execution order

1. `006` lands first: it is pure correctness and carries no visual risk.
2. `007` and `008` establish the vocabulary the surface work composes from.
3. `013` lands its showcase route early, so `009`–`012` are reviewable as they are built.
4. `009`–`012` apply the vocabulary surface by surface.
5. `013` closes with the review checklist and the responsive/theme regression matrix.

### Dependencies

- `008` depends on `007`.
- `009`–`012` depend on `008`.
- `013`'s showcase route depends on `008`; its regression matrix depends on `009`–`012`.

### Design principles

Quieter's product surfaces follow one rule: **quiet structure** — enough hierarchy to make the
product effortless, never enough chrome to make it loud.

- One clear focal point per screen.
- Mostly monochrome. Color carries state, never decoration.
- Atmosphere is layered by density: full expression on marketing, a quieter version in the workspace,
  the lightest touch in Settings and forms.
- Motion is state-based in the product and expressive only on marketing. See `001`.
- Blank space is room to work, not unused layout. Do not fill it.
