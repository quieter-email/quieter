# 003 — Polish mailbox switcher states and entrances

- **Status**: DONE
- **Commit**: 96e4ceb2
- **Severity**: HIGH
- **Category**: Feedback, physicality, and interruptibility
- **Estimated scope**: 2 files, medium

## Problem

Mailbox identity changes use the default 500ms `VerticalSlot` conveyor:

```tsx
// apps/web/src/features/navigation/components/mailbox-switcher.tsx:469 — current
<VerticalSlot className="min-w-0">
```

Rows distinguish the current mailbox mostly with `bg-background`, while hover/focus uses the menu's
per-row highlight. Reconnect, default, active, drag, and pressed states compete rather than forming
one hierarchy. There is no first/new mailbox-row entrance.

## Target

- The trigger identity uses a short eased opacity transition; switching never waits on motion.
- Active is a stable, bordered/tonal surface and never receives the transient hover surface.
- Pointer hover and keyboard focus share one moving/fading surface between inactive rows.
- Press feedback is `scale(0.985)` at the feedback duration; reduced motion keeps color/opacity
  only.
- Reconnect is an explicit compact destructive status/action; default mailbox is conveyed by the pin
  without another row background.
- Mailbox rows use the shared `8px`/`6px` fly-in blur only the first time existing rows are
  meaningfully presented and when a genuinely new mailbox first appears.
- Stagger is `40ms`, capped at `160ms`; reopening, filtering, selecting, or reordering does not replay.
- Drag source lift/opacity and group disclosure remain interruptible.

## Repo conventions to follow

- Reuse `SidebarSimpleHoverSurface` and the navigation surface domain.
- Keep DnD ownership in `mailbox-switcher.tsx`; do not add another drag library.
- Continue using Base UI `DropdownMenuItem` so keyboard roving focus and selection semantics remain.

## Steps

1. Add open-state tracking to calculate entrance IDs only when the switcher is presented; mark IDs as
   seen after that presentation.
2. Wrap only entrance-eligible row content in reduced-motion-aware fly-in motion; leave the sortable
   ref/positioning wrapper stable.
3. Add one inactive hover/focus surface and suppress it for the active row.
4. Refine row classes for active, pressed, drag, reconnect, and default states without multiple
   competing backgrounds.
5. Set `VerticalSlot` to the feedback duration or replace its directional travel with an opacity-only
   identity update.
6. Rotate one disclosure chevron instead of swapping two icons; keep the existing interruptible
   disclosure behavior and reduced-motion branch.

## Boundaries

- Do NOT replay row motion on dropdown reopen, filtering, selection, or reorder.
- Do NOT animate active selection between rows.
- Do NOT change mailbox ordering persistence or permissions.

## Verification

- **Mechanical**: typecheck, lint, existing mailbox switcher tests if present, and repository commands.
- **Feel check**:
  - Open once with many groups: final row delay never exceeds 160ms and all rows are interactive
    immediately.
  - Close/reopen, filter, select, reorder: no entrance replay.
  - Add a mailbox in local/demo data: only the new row enters once.
  - Keyboard through rows: focus and active remain distinct with no flashing over the active row.
- **Done when**: every row state is legible at a glance and switching feels immediate.
