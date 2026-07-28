# 001 — Establish the app motion vocabulary

- **Status**: DONE
- **Commit**: 96e4ceb2
- **Severity**: HIGH
- **Category**: Accessibility, cohesion, and tokens
- **Estimated scope**: 3 files, small

## Problem

The main app has no shared motion vocabulary. Curves and durations are repeated across navigation,
mail, and chat, while reduced motion is handled by a universal kill switch:

```css
/* apps/web/src/styles.css:39 — current */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-delay: 0ms !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

This erases useful opacity/color feedback but does not reliably prevent Motion-for-React layout and
transform animation.

## Target

Create a small app-owned vocabulary with these exact values:

- Feedback: `160ms`
- Semantic enter: `240ms`
- Layout movement: `280ms`
- Stagger: `40ms`, capped at `160ms`
- Strong enter/exit ease: `cubic-bezier(0.23, 1, 0.32, 1)`
- On-screen movement ease: `cubic-bezier(0.77, 0, 0.175, 1)`
- Fly-in: at most `translate3d(0, 8px, 0)` and `blur(6px)`, never scale from zero
- Reduced motion: opacity/color only, no transform, blur, scale, layout projection, or stagger

The TypeScript module exports values and reduced-motion-aware builders, not one universal variant
object that unrelated features must import unchanged. Each feature composes the vocabulary locally.

## Repo conventions to follow

- App-only behavior belongs under `apps/web/src/features`.
- `motion/react` is already the app motion dependency.
- CSS variables for app focus behavior already live in `apps/web/src/styles.css:4-6`.
- Do not move these tokens into `packages/ui`; this issue is scoped to the main app.

## Steps

1. Add `apps/web/src/features/motion/app-motion.ts` with exact easing tuples, duration values,
   capped-stagger calculation, and reduced-motion-aware fly-in state builders using full
   `transform` strings.
2. Add matching CSS custom properties in `apps/web/src/styles.css`.
3. Replace the universal reduced-motion transition-duration override with explicit app-motion
   semantics: keep short opacity/color feedback and remove spatial movement from participating
   components.
4. Add `apps/web/src/features/motion/README.md` documenting frequency rules, the shared vocabulary,
   reduced-motion behavior, and when not to animate.

## Boundaries

- Do NOT change shared `@quieter/ui` component behavior.
- Do NOT add a dependency.
- Do NOT turn every existing transition into a token migration; change only QUIETER-108 surfaces.

## Verification

- **Mechanical**: `vp check --fix`, `vp run check:copy`, `vp test`, `vp run -r build`.
- **Feel check**:
  - Inspect a semantic entrance at 10% speed: it begins within one frame, travels no more than 8px,
    and finishes within the semantic entrance duration plus capped stagger.
  - Toggle reduced motion: transforms, blur, scale, layout projection, and stagger disappear while
    opacity/color feedback remains brief and legible.
- **Done when**: navigation, mail, and chat consume the same values without sharing one
  feature-specific variant.
