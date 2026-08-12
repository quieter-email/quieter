# 011 — Standardize the Settings controls

- **Status**: DONE
- **Severity**: MEDIUM
- **Category**: Component vocabulary
- **Estimated scope**: 9 files, medium

## Problem

Settings' structure and information architecture are good and stay as they are. The problem is
individual controls that bypass the shared vocabulary, most visibly in the usage panels.

### Three different switches

Fourteen call sites, three appearances:

| Treatment                                                        | Sites |
| ---------------------------------------------------------------- | ----- |
| Primitive default (`h-6 w-11` track, `size-5` thumb)             | 2     |
| `switchVariants()` from `mailboxes-settings-shared.ts`            | 5     |
| The same string duplicated inline, character for character        | 4     |
| `h-5 w-9 shrink-0 p-0.5` with a separately overridden thumb       | 1     |

Sites that overrode only the thumb (`size-4` + `translate-x-4`) inside the default `w-11` track left
the thumb stopping 8px short of the end. The app had already converged on a compact switch; that
decision was just stranded in a settings-local `cva` instead of the primitive.

### A foreign palette

`usageBreakdownConfig` used `sky`, `teal`, `amber`, `violet`, `emerald`, and `orange` — twelve raw
Tailwind palette colors, the only ones in the repository, bypassing the `q-*` categorical palette
that exists for exactly this.

### A hand-rolled status chip

```tsx
// organization-mail-usage-settings.tsx:622 — before
<span className="squircle rounded-md border border-success/30 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
```

## Target

- One switch, in two sizes, defined once.
- Categorical color comes from `q-*`.
- Status chips are `Pill`.

## Steps

1. Move the compact switch into `@quieter/ui/switch` as `size="sm"`, with the track and thumb sized
   from one `cva` pair and the thumb reading its size from context so callers never pass it twice.
   Both sizes are geometrically exact: travel equals `width - 4px - thumb`.
2. Adopt the app's better unchecked track (`border-border bg-muted`) into the primitive; a bare
   `bg-bg-elevated` track is nearly invisible against the dark canvas.
3. Add `data-checked:bg-primary-fg` to the thumb so it stays legible on the checked track in both
   themes.
4. Replace every ad-hoc track and thumb override with `size="sm"`, then delete `switchVariants`.
5. Map `usageBreakdownConfig` onto `q-*`. Those tokens carry their own light/dark values, so the
   `dark:` variants go away.
6. Replace the hand-rolled "Unlimited" chip with `<Pill tone="green">`.

## Boundaries

- Do NOT restructure the Settings pages. The current categorization, overview, and lazy-loading are
  strengths; this plan touches controls only.
- Do NOT reduce `settingsSurfaceVariants` in this pass. Ten row variants is more than needed, but
  collapsing them changes layout, which is out of scope for a control-level pass.

## Verification

- **Mechanical**: `vp check`, `vp test`, and a sweep confirming no raw Tailwind palette colors
  remain.
- **Measured in the running app**: the `sm` switch is a 36px track with a 16px thumb, 3px gaps, and
  16px of travel.
- **Note for reviewers**: transitions do not advance when the browser pane is not compositing
  frames, so a `translate` read mid-transition reports `0px`. Call `getAnimations().forEach(a =>
  a.finish())` before measuring, or measure margin-driven properties instead.
- **Done when**: no Settings control invents its own appearance.
