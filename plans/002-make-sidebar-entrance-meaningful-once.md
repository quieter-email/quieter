# 002 — Make the sidebar entrance meaningful once

- **Status**: DONE
- **Commit**: 96e4ceb2
- **Severity**: HIGH
- **Category**: Purpose, frequency, and duration
- **Estimated scope**: 5 files, medium

## Problem

The first sidebar reveal uses 100ms stagger steps and 500ms item motion:

```ts
// apps/web/src/features/navigation/components/mail-sidebar.tsx:102 — current
const getSidebarEntranceDelay = (step: number) => step * 0.1;
const getSidebarEntranceInitial = (animateEntrance: boolean) =>
  animateEntrance ? { opacity: 0, x: -20, filter: "blur(8px)" } : false;
```

Settings starts at step nine and can finish at 1.4 seconds. Labels are additionally withheld behind a
900ms timer at `apps/web/src/features/navigation/components/sidebar-label-nav.tsx:250-257`.
The row call at `sidebar-label-nav.tsx:528` passes `animateEntrance` as a truthy shorthand instead of
the one-time `shouldAnimateEntrance` state, so label rows replay when the view remounts.

## Target

- Preserve one meaningful sidebar entrance per browser session.
- Preserve the original `500ms` ease-out character and `translate3d(-20px, 0, 0)` / `blur(8px)`
  treatment.
- Tighten the original stagger modestly from `100ms` to `75ms` without flattening the cascade.
- Never delay rendering or pointer/keyboard access for the entrance.
- Label headers, loading/error/empty states, and existing rows never re-stagger after navigation,
  mailbox/category changes, cached restoration, or refocus.
- Remove the one-second Settings icon rotation; frequent navigation keeps color and press feedback.

## Repo conventions to follow

- Keep active/hover surfaces in
  `apps/web/src/features/navigation/domain/sidebar-surfaces.ts`.
- Keep the session-level entrance ownership in `MailSidebar`; child components receive a boolean.
- Use the values from `apps/web/src/features/motion/app-motion.ts`.

## Steps

1. Replace the four duplicated sidebar entrance helpers with one reduced-motion-aware entrance
   component while preserving the original visual character.
2. Change Motion shorthand `x` to a full `transform` string and branch for reduced motion.
3. Remove `isLabelEntranceSlotOpen` and its timeout; render loading/error/empty/rows immediately.
4. Pass `animateEntrance={shouldAnimateEntrance}` to every label entrance and capture the initial
   decision once per mounted row.
5. Remove the 360-degree Settings hover rotation in both the populated sidebar and no-mailbox state.
6. Retain immediate keyboard/category selection without moving the active surface.

## Boundaries

- Keep active state stable and use shared, eased hover surfaces between inactive rows.
- Do NOT alter navigation structure, labels data flow, or mailbox selection behavior.
- Do NOT delay content mounting to coordinate stagger.

## Verification

- **Mechanical**: navigation and mailbox component tests plus the repository commands in plan 001.
- **Feel check**:
  - Fresh-load once: the sidebar retains its deliberate original cascade with a slightly tighter
    rhythm.
  - Return from Settings, switch categories/mailboxes, refocus the tab: no label row replays.
  - Reduced motion: a brief opacity entrance only; no blur or translation.
- **Done when**: initial polish remains, repeated navigation is static and immediate.
