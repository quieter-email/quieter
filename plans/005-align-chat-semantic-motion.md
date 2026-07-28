# 005 — Align chat semantic motion

- **Status**: DONE
- **Commit**: 96e4ceb2
- **Severity**: HIGH
- **Category**: Purpose, performance, and accessibility
- **Estimated scope**: 8 files, medium

## Problem

The controlled composer carries layout projection on every render:

```tsx
// apps/web/src/features/chat/components/chat-composer.tsx:45 — current
<m.form
  layout
  layoutId="composer"
  transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
>
```

Typing changes the controlled textarea on every keystroke. Chat disclosures separately duplicate
`140ms [0.16, 1, 0.3, 1]` `y` entrances, and reduced motion does not consistently branch JS motion.
Existing transcript turns are intentionally static, but newly committed semantic turns also have no
one-time distinction.

## Target

- Typing, submission, streaming tokens, rejoin hydration, and reopening existing transcript content
  never trigger entrance or layout projection.
- The composer may move from centered empty-chat position to the bottom once, using the shared
  layout duration
  ease-in-out; reduced motion switches instantly with opacity continuity.
- A newly committed semantic user/assistant turn may enter once with opacity and at most
  `translate3d(0, 6px, 0)` using the shared strong ease-out. Streaming updates never replay it.
- Tool activity, reasoning, inline compose, error, and completion changes share the same semantic
  disclosure timing and reduced-motion policy.
- Autoscroll remains `"auto"` during generation; `"smooth"` stays reserved for the explicit
  scroll-to-bottom action.

## Repo conventions to follow

- Existing transcript IDs and `createChatTurns` provide stable semantic identities.
- Keep `AnimatePresence initial={false}` for state disclosures.
- Continue using Motion only where dynamic/interruptible layout is required; use full transform
  strings for predetermined entrances.

## Steps

1. Move layout ownership outside the controlled `ChatComposer` so keystrokes do not participate in
   layout projection.
2. Add transcript-local seen-turn tracking initialized from hydrated turns; only IDs introduced
   after mount are entrance-eligible, and streaming part updates do not change eligibility.
3. Compose new-turn motion from shared values with reduced-motion opacity-only behavior.
4. Replace duplicated `y` disclosure tweens in reasoning/tool components with a shared chat-local
   semantic reveal composed from the app vocabulary.
5. Give inline compose and error state changes the same one-time semantic reveal; do not animate
   token text.
6. Branch the scroll-to-bottom control and recording/transcription status for reduced motion and use
   full transform strings.
7. Preserve existing automatic scroll behavior and caret/loading state indicators.

## Boundaries

- Do NOT animate per token, per markdown rerender, per keystroke, or hydrated transcript content.
- Do NOT make automatic streaming autoscroll smooth.
- Do NOT add bounce to chat.

## Verification

- **Mechanical**: chat domain/component tests and repository commands.
- **Feel check**:
  - Type rapidly in an empty and existing chat: the composer does not run layout animation.
  - Send once: the new semantic turn enters once; streaming text itself stays still.
  - Reopen/rejoin: every existing turn is immediately present with no cascade.
  - Toggle reasoning/tool state rapidly: motion reverses cleanly.
  - Reduced motion: opacity/color only, no positional or layout movement.
- **Done when**: chat feels related to mail without animating its continuous work.
