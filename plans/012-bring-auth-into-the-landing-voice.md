# 012 — Bring Auth into the landing page's voice

- **Status**: PARTIAL
- **Severity**: MEDIUM
- **Category**: Accessibility and copy
- **Estimated scope**: 2 files, small

## Problem

The auth form carried no visible labels. Both fields relied on a placeholder plus an `aria-label`:

```tsx
// apps/web/src/components/auth-screen.tsx:306 — before
<TextFieldInput aria-label="Name" placeholder="Name" … />
```

A placeholder disappears on first keystroke, so the field loses its name exactly when a user is most
likely to need it, and the duplicated `aria-label`/`placeholder` pair is redundant.

Loading copy also used ASCII ellipses (`"Opening..."`, `"Adding you to the waitlist..."`) where the
rest of the product uses `…`.

## Target

- Visible, correctly associated labels.
- One ellipsis character across user-facing copy.

## Steps

1. Add `FieldLabel` with an explicit `htmlFor` and a matching `id` on each input. `TextField` is
   Base UI's `Field.Root`, but the inputs are `Input` rather than `Field.Control`, so the
   association must be explicit rather than inferred from context.
2. Drop the now-redundant `aria-label` and the placeholder that merely repeated the label.
3. Replace `...` with `…` in both files.

## Remaining

The plan also called for reducing the visual competition around the form and bringing the auth
layout closer to the landing page's typography and atmosphere. That is not done. It should be
approached as a refinement of `auth-visual.tsx` and the surrounding layout, not of the form itself.

## Boundaries

- Do NOT remove the preview-persona buttons; they are a local-only testing aid.
- Do NOT add a placeholder back alongside a visible label.

## Verification

- **Mechanical**: `vp check`, `vp test`.
- **Not yet verified in a browser**: the running dev session is signed in, so `/auth` redirects to
  the mailbox. Sign out before reviewing, and confirm each input's accessible name comes from its
  visible label.
- **Done when**: the entry point feels like the same product without shouting.
