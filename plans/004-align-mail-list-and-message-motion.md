# 004 — Align mail list and message motion

- **Status**: DONE
- **Commit**: 96e4ceb2
- **Severity**: HIGH
- **Category**: Purpose, performance, and cohesion
- **Estimated scope**: 7 files, medium

## Problem

The list and detail independently duplicate a cinematic pane preset:

```ts
// apps/web/src/features/message-list/components/message-list.tsx:29 — current
const messageListContentMotion = {
  initial: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  animate: { opacity: 1, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, scale: 0.96, filter: "blur(14px)" },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;
```

The detail has the same object. Both panes mount together and are toggled with `hidden`, so the
motion does not consistently explain opening a message. Keyboard J/K focus also animates a 100ms
row box shadow, and new virtual rows use Motion `y`/`scale` shorthands with an uncapped stagger.

## Target

- No animation trails keyboard focus or archive/trash triage.
- Mailbox/category and message-detail changes use a compact eased fade, blur, and small directional
  shift so the surface change is visible without blocking input.
- Pointer hover and active-message state use separate shared surfaces that glide between rows;
  avatar/selection clicks never trigger the main row's press scale.
- Thread headers keep labels in the third row and sender-name font metrics stable in both expansion
  states. The header remains a click target, but selecting its text does not toggle the message.
- Genuinely new arriving rows retain subtle motion without moving scroll position: full transform
  string, opacity, `40ms` stagger capped at `160ms`, and no scale.
- Reduced motion uses opacity only with no stagger.
- Empty/resting states are static; no perpetual decorative dot motion.
- Thread expansion removes unused transition properties and keeps surrounding content stable.

## Repo conventions to follow

- Preserve TanStack Virtual positioning: the outer `<li>` owns `translateY(offsetY)`.
- Preserve direct cache patching and immediate semantic mail actions.
- Keep avatar/selection-control crossfade unchanged; it is already 100ms and starts at scale 0.95.

## Steps

1. Replace duplicate pane presets with locally composed shared app-motion values and gate them to
   first meaningful presentation, or delete them where the pane mounts invisibly.
2. Remove the CSS transition from the J/K-owned message-row focus ring.
3. Put CSS press feedback on the actual row trigger, not the whole row or avatar/selection target.
4. Convert new-row `y`/`scale` to a full `translate3d` transform plus opacity; cap stagger at 160ms.
5. Make `EmptyMessageState` static or play only a single first-appearance opacity sequence.
6. Keep thread expansion coordinated with a short grid, opacity, transform, and chevron transition.
7. Keep loading/error/empty swaps inside stable reserved regions with opacity-only feedback.

## Boundaries

- Do NOT add exit choreography to archive, spam, trash, or bulk triage.
- Do NOT animate list scroll position.
- Do NOT replay existing rows after navigation or cached restoration.

## Verification

- **Mechanical**: message list/selection tests and repository commands.
- **Feel check**:
  - Hold J/K: focus keeps up frame-for-frame and rows do not scale or trail.
  - Receive several new rows: scroll position is unchanged, only new rows enter, last delay ≤160ms.
  - Open/close and move through messages rapidly: no double-exposure or queued motion.
  - Test a long HTML thread at 4× CPU slowdown; expansion remains responsive.
- **Done when**: mail motion explains new content without slowing triage.
