# 010 — Anchor Chat to the product shell

- **Status**: DONE
- **Severity**: HIGH
- **Category**: Cohesion and empty states
- **Estimated scope**: 1 file, small

## Problem

Chat read as a separate product. Its narrow-viewport header was a plain text button at a height no
other surface used:

```tsx
// apps/web/src/features/chat/components/chat-view.tsx:182 — before
<header className="flex min-h-14 items-center px-3 lg:hidden">
  <Button onClick={onOpenSidebar} size="sm" variant="ghost">Sidebar</Button>
</header>
```

An empty chat showed only a composer floating in a large empty canvas, with no title, no starting
point, and no indication of what Chat is for. An active conversation had no header at all on desktop,
so the chat's own title was never visible.

## Target

- The same narrow-viewport header as every other surface.
- An empty state with a short title and one or two starting prompts.
- The conversation's title visible while reading it.

## Steps

1. Replace the ad-hoc header with `MobileHeader`, passing the chat title once a conversation exists.
2. Add a desktop-only conversation header showing the title.
3. Give the empty state a short title and two example prompts that fill the composer through
   `onInputChange` rather than sending immediately, so the user can edit before committing.

## Boundaries

- Do NOT rename the models. `packages/ai/src/chat-models.ts` already maps ids to curated labels
  ("GPT 5.6 Luna", "Claude Opus 5"); those are product names, not leaked identifiers.
- Do NOT add a Quieter mark to the empty state. `quieter-mark.tsx` was dead code whose geometry did
  not match `public/icon.svg` (rounded rects instead of superellipse paths, perfectly concentric
  instead of progressively offset, no backing tile), and it has been deleted. If an inline mark is
  ever wanted, derive it from the real icon paths.
- Do NOT animate the example prompts; they unmount on the first message.
- Keep the composer's `layoutId` transition. It is the one piece of brand motion Chat keeps.

## Verification

- **Mechanical**: `vp check`, `vp test`.
- **Manual**: empty chat shows title, composer, and prompts with no overflow; opening a conversation
  reveals its title on desktop and in the mobile header.
- **Done when**: Chat looks like it belongs to the same product as Mail.
