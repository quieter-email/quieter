# 006 — Close the verified frontend defects

- **Status**: DONE
- **Severity**: HIGH
- **Category**: Correctness, accessibility, and token discipline
- **Estimated scope**: 5 files, small

## Problem

Three defects were confirmed against the running app and the source. They are independent of the
visual redesign and carry no layout risk, so they land before any surface work.

### Duplicate hotkey registration

`MessageList` and `MessageDetail` are siblings in `mailbox-messages-panel.tsx` and are both mounted
whenever a message is open. Both declared `E`, `Shift+3`, `Shift+1`, `Shift+I`, `Shift+U`, and `U`.

`HotkeyManager#findConflictingRegistration` compares hotkey and target only — it never consults
`enabled` — so every one of those pairs warned on every mount, even though most were mutually
exclusive at runtime through the list's `activeMessageId` gate.

`U` was not mutually exclusive. The list enabled it *because* a message was active
(`message-list.tsx:138`), and the detail view enabled it whenever `onBackToList` existed
(`message-view.tsx:1316`). Both fired.

### Unguarded perpetual animation

```tsx
// apps/web/src/components/empty-message-state.tsx:21 — before
<m.span animate={{ opacity: [0, 0.5, 0] }} transition={{ repeat: Infinity }} />
```

The reduced-motion fallback in `apps/web/src/styles.css:12` is CSS-only and does not reach
Motion's JS-driven animation, so the mail reader ran a perpetual animation for users who asked for
no motion.

### Raw branded color

```tsx
// apps/web/src/features/settings/components/action-simple-editor.tsx:384 — before
<span className="rounded-full border border-[#5e6ad2]/40 bg-[#5e6ad2]/15 px-1.5 py-0.5 text-[#b8bef8]">
```

This violated the standing AGENTS.md rule against arbitrary bracketed color values, and had no dark
or light theme response.

## Target

- Only the active context registers a shared key; no duplicate-registration warnings.
- `U` has exactly one owner.
- No JS-driven animation ignores reduced motion.
- No arbitrary color values anywhere in `apps/web/src` or `packages/ui/src`.

## Steps

1. Add `omitDisabledHotkeys` to `features/hotkeys/domain/hotkey-guards.ts` and filter both
   `useHotkeys` arrays through it, so a disabled definition is never registered.
2. Delete the `U` definition from `useMessageViewHotkeys`. The list keeps ownership because it also
   restores the focus ring through `requestFocusRing()`, which is list-internal state the detail view
   cannot reach. `onBackToList` stays a parameter — the archive action still uses it.
3. Branch `EmptyMessageState`'s mark on `useReducedMotion()` and render static dots when reduced.
4. Replace the branded span with the shared `Pill` at `tone="purple"`.

## Boundaries

- Do NOT suppress the warning with `conflictBehavior: 'allow'` — that hides real conflicts.
- Do NOT change which keys are bound or what they do. The shortcut catalog stays accurate.
- Do NOT remove the empty state's mark under reduced motion; hold it still instead.

## Verification

- **Mechanical**: `vp check`, `vp test`, and the new `omitDisabledHotkeys` cases in
  `hotkey-guards.test.ts`.
- **Manual**: open a message on desktop and confirm the console is clean; press `U` and confirm one
  navigation back with the focus ring restored.
- **Done when**: the mail workspace mounts silently and honors reduced motion.
