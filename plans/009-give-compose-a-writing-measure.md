# 009 — Give Compose a writing measure

- **Status**: DONE
- **Severity**: HIGH
- **Category**: Layout and hierarchy
- **Estimated scope**: 3 files, medium

## Problem

Compose had no width constraint anywhere. `compose-workspace.tsx` put the form directly in
`WorkspaceSection`, so on a 1440px window the recipient fields and body editor stretched the full
1156px panel. Labels were small, fields spanned the whole workspace, and the toolbar sat below the
editor separated by a `gap-3`, reading as a detached bar rather than part of the writing surface.

The blank space felt unused rather than like room to write.

## Target

- A comfortable writing measure, matching the measure the reader already implies (`max-w-3xl`).
- Recipients, subject, and body visibly grouped.
- The toolbar belongs to the editor.

## Steps

1. Move padding off the `form` and into a centered `mx-auto max-w-3xl` column so the mobile header
   still spans the panel edge to edge.
2. Give the recipients block a bottom rule to separate addressing from writing.
3. Wrap `ComposeEditorBody` and `ComposeEditorToolbar` in one bordered frame; strip the inner
   border/radius/shadow from both and divide them with a single `border-t`.
4. Move the body error list below the frame so the frame is never interrupted.
5. Match `ComposeWorkspaceLoading` to the same measure so nothing jumps when Compose resolves.

## Boundaries

- Do NOT constrain the mobile header; it is panel chrome and spans the full width.
- Do NOT change the editor's focus treatment. `has-[.ProseMirror:focus-visible]` already handles it.

## Verification

- **Mechanical**: `vp check`, `vp test`.
- **Measured in the running app**: at 1440px the column is 768px centered in a 1156px workspace, the
  frame is 704px with the toolbar inside it. At 375px there is no horizontal overflow and the header
  is 48px.
- **Done when**: the blank space reads as room to write.
