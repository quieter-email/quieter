# 007 — Complete the semantic token vocabulary

- **Status**: DONE
- **Severity**: HIGH
- **Category**: Tokens and theme consistency
- **Estimated scope**: 3 files, small

## Problem

`packages/ui/src/styles.css` already carries a coherent vocabulary: surfaces, text, borders, a
typography scale, a radius scale, easing, and shadows. The system does not need renaming. It has
three concrete gaps that components route around.

### `--card` reverses polarity between themes

```css
/* light */
--bg: oklch(0.975 …);  --bg-surface: oklch(1 …);     --card: var(--bg-surface);   /* above canvas */
/* dark */
--bg: oklch(0.218 …);  --bg-elevated: oklch(0.145 …); --card: var(--bg-elevated); /* below canvas */
```

A card sits above the canvas in light and below it in dark. `--bg-surface` is already the correct
raised surface in both themes (`1` over `0.975`; `0.255` over `0.218`), so the dark mapping is simply
wrong. This is the direct cause of Settings cards whose boundaries are barely legible.

### No border weight above `--border`

`--border` is deliberately faint at `0.6` alpha. Surfaces that must actually read as grouped have
nothing to reach for, so they either stack extra shadows or accept an invisible edge.

### No scale step below `--text-caption`

`--text-caption` is `0.75rem`. Dense metadata wants 11px, so `text-[11px]` appears 19 times across
chat tool parts, inline compose, and label chips, plus `text-[0.8rem]` 4 times where `--text-body-sm`
(`0.8125rem`) was meant.

## Target

- A card reads as raised in both themes.
- One border weight above the default, for real grouping.
- Every text size in the app comes from the scale.

## Steps

1. Point dark `--card` at `--bg-surface`, matching light.
2. Add `--border-strong` to both themes and expose `--color-border-strong` in `@theme inline`.
3. Add `--text-micro` (`0.6875rem`) with its line height to the typography scale.
4. Replace `text-[11px]` with `text-micro` and `text-[0.8rem]` with `text-body-sm` across the app.

## Boundaries

- Do NOT rename the existing token set. `bg`/`bg-surface`/`fg`/`muted-fg`/`border` stay as they are;
  a mechanical rename across ~97 files carries regression risk and no user-visible gain.
- Do NOT add `status-*` aliases. `--success`, `--warning`, and `--destructive` already carry those
  semantics, and `q-*` remains the categorical palette behind `Pill`.
- Do NOT introduce a token without a consumer in this repository.
- Do NOT fold `text-[10px]` into `--text-micro`; `Pill`'s `xs` size is a deliberate separate step.

## Verification

- **Mechanical**: `vp check`, `vp test`, and a repository sweep confirming no arbitrary color or
  `text-[11px]` values remain.
- **Manual**: Settings cards and accordions read as grouped in dark without gaining weight.
- **Done when**: no component needs an arbitrary value to express a normal visual intent.
