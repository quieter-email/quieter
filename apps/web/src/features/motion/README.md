# Main app motion

Quieter is a daily-use email client. Its motion is selective but clearly visible: it confirms input, preserves spatial continuity, and explains genuinely new content. Repeated keyboard triage, streaming text, and background refreshes stay still, while surface changes and pointer-led navigation receive enough time and easing to feel composed.

## Vocabulary

- **Press / Tap feedback** — A subtle scale-down when an element is clicked, so it feels physical.
- **App entrance** — A restrained composition of **Fade in / Fade out** — Element appears or disappears by changing opacity; **Translate** — Move an element along the X or Y axis; and **Blur** — A blur filter used to soften an element or mask tiny imperfections. Quieter reserves it for the first meaningful presentation of a surface or genuinely new semantic content.
- **Stagger** — Animate several items one after another with a small delay between each, creating a cascade.
- **Layout animation** — When an element's size or position changes, it animates to the new spot instead of snapping.
- **Continuity transition** — A change that keeps the user oriented by visually connecting before and after. For example, making the same rectangle bigger and smaller.
- **Reduced motion** — Respecting the user's prefers-reduced-motion setting by toning down or removing motion.

## Values

The canonical TypeScript values live in `app-motion.ts`; matching CSS values live in `apps/web/src/styles.css`.

| Intent                    | Value                             |
| ------------------------- | --------------------------------- |
| Feedback                  | 160ms                             |
| Semantic entrance         | 240ms                             |
| Layout movement           | 280ms                             |
| Enter/exit easing         | `cubic-bezier(0.23, 1, 0.32, 1)`  |
| On-screen movement easing | `cubic-bezier(0.77, 0, 0.175, 1)` |
| Group stagger             | 40ms, capped at 160ms             |
| Fly-in distance / blur    | at most 8px / 6px                 |

Feature code composes these values locally. Do not export a mailbox, message, or chat variant for an unrelated feature to consume.

## Frequency rules

- Keyboard-triggered triage stays immediate.
- Hover and selection surfaces use eased fades and shared layout movement so adjacent targets feel connected; direct press feedback stays short.
- Drawers, disclosures, and meaningful new blocks may use standard motion.
- First-run and first meaningful entrances may use the fly-in treatment once.

Existing data must never re-enter after back navigation, mailbox/category changes, cache restoration, filtering, refocus, chat reopen, or stream rejoin.

## Reduced motion

Retain short opacity and color feedback. Remove positional movement, blur, scale, layout projection, and stagger. Motion-for-React code must branch with `useReducedMotion`; CSS must not rely on movement to communicate state.
