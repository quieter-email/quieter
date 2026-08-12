# 008 — Consolidate shared surface and row primitives

- **Status**: PARTIAL
- **Severity**: HIGH
- **Category**: Component vocabulary
- **Estimated scope**: 8 files, medium

## Problem

The design pass proposed twelve new primitives. Most already exist under other names, and building
fresh ones would fork the system rather than consolidate it.

| Proposed      | Already exists                                          |
| ------------- | ------------------------------------------------------- |
| `Surface`     | `WorkspaceSection` (`components/workspace-section.tsx`)  |
| `EmptyState`  | `EmptyMessageState` (`components/empty-message-state.tsx`)|
| `StatusPill`  | `Pill` (`@quieter/ui/pill`)                              |
| `IconButton`  | `Button` + `IconButtonTooltip`                           |
| `Toolbar`     | `@quieter/ui/toolbar`                                    |
| `Avatar`      | `@quieter/ui/avatar`                                     |
| `FormField`   | `@quieter/ui/field` (`Field`/`FieldLabel`/`FieldControl`) |
| `SettingsRow` | `settingsSurfaceVariants` in `settings-layout.tsx`       |

Only `MobileHeader` was genuinely absent, and it was absent in the most visible way: five surfaces
had five different narrow-viewport headers.

```tsx
compose-workspace.tsx:297        -mx-6 -mt-6 … border-b … px-6 py-3   icon-sm  SidebarLeftIcon  title
mailbox-workspace-content.tsx:138  (byte-identical duplicate of the above)
message-detail.tsx:131           min-h-12 … border-b … px-2          icon-lg  ArrowLeft01Icon  no title
chat-view.tsx:182                min-h-14 … px-3, no border          text Button "Sidebar"
template-workspace.tsx:216       @container p-4 sm:p-5               icon-sm  SidebarLeftIcon
```

`settingsSurfaceVariants` is the opposite problem: ten row variants (`divide`, `divider`,
`fieldRowShell`, `insetFieldRow`, `insetRow`, `insetSection`, `insetStackedRow`, `listRow`,
`padding`, `rowShell`) where three would do. That is the "many sections use similar row treatments
without enough hierarchy" symptom, expressed as a CVA.

## Target

- One narrow-viewport header for every mobile-only bar.
- Existing primitives extended rather than replaced.
- The Settings row vocabulary reduced to a set a reviewer can hold in mind.

## Steps

1. Add `components/mobile-header.tsx` with `leading` (`sidebar` | `back`), optional `title`, and a
   trailing slot. Migrate Compose, the Compose loading shell, message detail, and Chat onto it.
2. Give `EmptyMessageState` an optional `action` slot and reduced-motion-safe mark (done in `006`).
3. Reduce `settingsSurfaceVariants` to a coherent set as part of `011`, where the consumers are.

## Boundaries

- Do NOT convert `template-workspace.tsx` or `message-list-search-view.tsx` to `MobileHeader`. Their
  sidebar buttons live inside a header that is also present on desktop; the control treatment already
  matches (`icon-sm`, `SidebarLeftIcon`, `IconButtonTooltip`), and forcing the mobile-only container
  onto them would regress the desktop layout.
- Do NOT move `MobileHeader` into `@quieter/ui`. It is product chrome composed from `@quieter/ui`
  parts, not a generic primitive, and it belongs with the app shell.
- Do NOT create `Surface`, `PageHeader`, `StatusPill`, `IconButton`, `Avatar`, or `Toolbar`. They
  exist.

## Verification

- **Mechanical**: `vp check`, `vp test`.
- **Manual**: at 390px every product surface shows the same header height, icon size, and tooltip.
- **Done when**: a new surface can reach for a header without inventing one.
