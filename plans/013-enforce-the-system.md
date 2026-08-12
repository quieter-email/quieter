# 013 — Enforce the system

- **Status**: PARTIAL
- **Severity**: HIGH
- **Category**: Review tooling
- **Estimated scope**: 2 files, medium

## Problem

`apps/web/src/features/design-system/components/` existed and was empty. Without a place to see the
vocabulary, drift is invisible until it reaches a product surface, and reviewers have no way to
compare a new control against the existing ones.

The AGENTS.md rule against arbitrary color values was already in force and already violated
(`action-simple-editor.tsx:384`), which shows prose rules alone do not hold.

## Target

- One route that shows every control the product composes from, in both themes.
- Review questions a reviewer can actually apply.
- Regression coverage across the routes that matter.

## Steps

1. Add `/design-system` rendering `DesignSystemShowcase`: surfaces, borders, the full type scale,
   button variants and sizes, form controls, both switch sizes and their pending/disabled states,
   pills, the mobile header, and the empty state. Mark it `noindex`.
2. Keep it composed only from shipped primitives, so it cannot drift from the product by
   construction.

## Remaining

- **Visual regression coverage** across `/home`, inbox list, message detail, Compose, Chat empty,
  Chat conversation, Settings overview, Settings detail, Auth, and legal pages, at desktop and
  390px, in dark and light, and with reduced motion.
- **Lint enforcement** for raw Tailwind palette colors (`bg-sky-500` and friends). The bracketed-value
  rule is covered by AGENTS.md, but the named-palette case is what actually slipped through, and only
  a lint rule will catch the next one.

## Review questions for any new surface

- What is the canvas, what is the primary surface, what is the focal action?
- Which typography role, from the scale, not an arbitrary size?
- Which shared primitive owns each control?
- Does it hold at 390px without horizontal overflow?
- Does it work with keyboard focus?
- Does it hold still under reduced motion, including JS-driven motion, which the CSS fallback in
  `apps/web/src/styles.css` does not reach?

## Boundaries

- Do NOT let the showcase define its own styles. If something cannot be expressed with a shipped
  primitive, that is the finding.

## Verification

- **Mechanical**: `vp check`, `vp test`.
- **Manual**: `/design-system` renders eight sections; toggling the theme keeps `card` raised above
  the canvas in both (`0.975 → 1.0` light, `0.218 → 0.255` dark).
- **Done when**: a reviewer can answer every question above without opening the product.
