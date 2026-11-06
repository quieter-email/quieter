# Workspace patterns

## App shell and navigation

Canvas holds navigation. Main workspaces use Panel. Desktop workspace geometry comes from `WorkspaceSection`. Below the desktop breakpoint, panels become edge to edge, with no outer border, radius, shadow, or gutter. Do not keep a desktop shell squeezed into a narrow viewport.

Use `WorkspaceHeader` for the inset Section tray. Its controls use appropriate shared toolbar chrome. Keep its 2px margin distinct from 14px content padding and the panel's transparent structural border.

Adjacent panels align along their actual outer edges. Layout wrappers and docked chat use the shared `workspaceGutterClassName` and `--workspace-gutter`. Do not add another gap after a panel's existing margin. A trailing sidebar must not gain a double gutter.

Workspace content uses `min-h-0` and `min-w-0` where flex or grid children must shrink. Give scrolling to the content that should scroll. A header, body, and footer should not each accidentally create a separate viewport. Preserve safe-area and narrow-screen behavior.

`WorkspaceDock` owns the fixed-width sidebar transition and the adjacent content resize. Narrow screens overlay the dock. Product code owns open state and making covered content inert. Do not separately animate two widths and hope they remain aligned.

## Mail lists

Use the same system for mailbox lists, all inboxes, search results, and the one-panel route. Two panels is the default device preference. Narrow screens use one panel. Route state preserves message selection and the established back behavior.

The list header is a Section tray with search and toolbar controls. Mail rows live on the Panel beneath it. Idle rows normally have no separate card fill. Hovered and selected rows gain the rounded state surface through the shared recipes. Do not paint every row Detail or restore decorative row separators.

Use `MailListRowDetails`, `mailListRowFrameVariants`, and `mailListRowParts`. Preserve the distinction between the row's hit target, its inset highlight, its unread rail, and its metadata. Match state layers to the row outline. A transparent border can be structural without being a visible separator.

Stacked rows and adaptive wide rows share presentation. Wide rows keep sender and address together, align subjects as one column, and place attachment filenames and thread counts before labels and date. Stacked rows retain compact count Pills. Product code supplies formatted content, metadata, user labels, and actions. It should not recreate the row's visual recipe.

Unread markers use primary. Important-mail gradient treatment is restrained and clipped to the approved footprint. Do not replace the important marker with a new icon or gold slab during unrelated polish. Inspect the combination of important, unread, selected, hovered, and last-row corners.

Sender logos and fallbacks use `SenderAvatar`. Current mail row and message header sizes are distinct. Preserve fallback alignment when a brand image fails.

Mail action buttons use the established backgrounded Detail/control treatment when they are part of the mail header or action bar. A primary completion action still uses primary. Do not make every text link a filled box.

## Virtualization is a behavior contract

A row geometry change affects measurements. Keep actual rendered row heights live. After a hidden list returns at another width, restore its scroll anchor and focus. Width transitions from a dock can change wrapping and row height.

Measure individual rows as needed. Defer a full list measurement until the width animation settles. Do not erase virtualization or use a fixed height assumption to hide clipping. Verify switching one/two panels, opening chat, and returning from a selected message when that layout changed.

Absolute positioning inside a virtualizer is legitimate. It does not justify absolute positioning of ordinary row text. Keep sender, subject, metadata, labels, and actions in the shared flow layout.

## Reading pane and empty selection

The reading pane is a Panel. Message metadata, attachments, action controls, and composers use their established layers. External email content has separate formatting needs. Do not invert or strip a sender's HTML solely to make a screenshot dark. Where content is normalized for dark mode, preserve links, images, tables, quoted content, contrast, and the ability to inspect the original rendering.

When no message is selected, provide a minimal useful home for that pane. Recent opened mail and recent verification codes are appropriate dynamic examples. Keep the presentation lighter than a complete mail row. Do not duplicate Compose, Search, or Unread actions already one click away.

Show only context the current user is authorized to see. Mailbox ownership, expiry, and private content rules still apply to recents and codes. Handle the absence of recent data cleanly. Do not fill space with invented recommendations or repeat navigation just to avoid emptiness.

Thread navigation uses the current shared `ThreadRail` where established. It supports compact marks, nearby readable context, interaction, and selection state. Do not turn every message into a permanent expanded label. Preserve pointer proximity, drag, keyboard navigation, current-target feedback, scroll alignment, focus, and reduced motion. Inspect the current implementation before changing its spacing.

## Compose and inline reply

The writing area must be differentiated from the reading Panel. Compose and inline reply use the shared Section editor shell. Recipient rows and message text align to the same 16px horizontal inset. The footer is a nested Detail toolbar with complete rounding on all four corners and a small uniform inset.

Use `ComposerFrame`, `ComposerFieldGroup`, `ComposerFieldRow`, `ComposerEditorFrame`, the editor body components, and `Toolbar chrome="inset"` for their actual roles. Inline layout uses the shared inline mode instead of a copied miniature composer. `ComposerActionBar` serves the established compact reply-action arrangement and is not interchangeable with every toolbar.

Avoid these recurring defects:

- The reply body has the same fill as the reading Panel and disappears into it.
- Only the toolbar's lower corners are rounded.
- Header, body, and toolbar have different left or right edges.
- A toolbar extends beyond the clipped editor shell.
- The last attachment, microphone, delete, or close icon is cut off.
- The text baseline moves because a local button height or line height overrides the shared size.
- A short reply gains a large blank area from an unrelated fixed minimum height.

Fix the flex sizing, parent width, margin, and clipping owner. Do not hide the evidence with a negative right margin, overflow clipping on the icon, or per-button position tweaks. Test both inline and full compose because they share appearance but have different available space.

Preserve actual editing, attachments, recipients, quoted text, keyboard shortcuts, draft recovery, and send behavior. A styling pass must not replace the working editor with static text. Button progress is valid for actual Send; switch loading guidance does not ban useful action progress.

## Snippets

Snippets use the same header/list logic as mail. Keep the tray inset and row edge relation consistent with mail lists. Idle snippets normally sit directly on the Panel, with a rounded hover or selected background. Do not put the entire snippet collection in an unrelated thick-inset Section and then card every item.

Use clear title and preview columns at wide widths and an intentional narrow arrangement. Editing uses actual fields and the shared editor. Selecting, inserting, or editing a snippet must remain a discoverable existing interaction without extra visual chrome.

## Calendar workspace and navigation

The calendar is a Panel with the same inset Section header as other workspaces. The schedule itself is a rounded inset Section, not a raw grid attached to the panel edge. Its shared `Schedule` renderer owns day, week, month, and agenda treatment.

Keep the month label in a reserved, stable width or grid column so previous and next stay at fixed x coordinates. Consecutive clicks must not chase the arrows as month names change. Check a long month, a short month, year changes, and the localized date range. Do not solve this with a hardcoded English month label or clipping meaningful date text.

Keep date navigation, Today, view, time zone, search, refresh, and sidebar actions in a coherent responsive header. Allow deliberate wrapping or a compact adaptation at narrow widths. Do not squash labels into unusable fragments simply to retain a single line.

Calendar is provider-neutral. Preserve connection, reconnect, visibility, color, read-only, and unavailable states for every supported calendar account. Do not rebuild the sidebar as a Google-only view because an older mock predates other account types.

## Calendar schedule layers

The weekday row and all-day row form one nested header group. They use the appropriate Detail layer with a small inset and an inner contour derived from the surrounding Section. A full-width different-colored rectangle with only bottom rounding is not the approved treatment.

The timed body remains visually connected to its header. Preserve column alignment, the time gutter, hour scale, all-day cells, scroll synchronization, sticky behavior, and current-time feedback. Calendar grid lines communicate time/date structure and can remain subtle. Border reduction does not remove all structure.

Day, week, month, and agenda share the Section logic. Do not fix only week while leaving month or agenda square. Events retain their meaningful category color, content hierarchy, selection, drag, and resize behavior.

Absolute event placement is appropriate because time determines position. Prevent clipped event labels and preserve minimum interaction size. Do not change hour heights as a shortcut for general app density. Current schedule time geometry is an implementation constraint, not a new global spacing token.

## Calendar sidebars and event editor

Event-detail header and sibling editor groups use the same Section radius and edge relation. Their different content heights do not justify different corner rounding. Keep consistent title, all-day, date/time, time zone, recurrence, guests, location, description, calendar, color, reminders, availability, and visibility layout.

Use the shared date/time, selection, checkbox, and number controls. Align icons to the content row, not arbitrary absolute coordinates. Long descriptions wrap. Long time zones or calendar names have an intentional truncation or expansion path.

The event sidebar keeps the shared panel gutter once. Section content padding follows the established row layout. The outer shade gap stays small where it is a nested layer. Inspect the top, sides, and bottom together, including the final action footer.

## AI chat

Chat reuses the surface ladder and workspace header rather than a separate visual system. A docked transcript fills the available height. A floating conversation may retain its established height cap and measured positioning. Do not copy the floating cap into the full workspace.

The prompt uses `PromptComposerFrame` and the structured editor where established. Token fields must retain intrinsic height so multi-line content is not clipped. Context chips, attachments, tool feedback, errors, and send/stop actions use existing shared controls and states.

Open/close, dock/float, transcript scrolling, and content resizing must cooperate. Preserve keyboard focus and draft input across changes. Keep model/provider or infrastructure names out of ordinary product copy unless the user needs to configure or interoperate with them.

Account mentions, context insertion, tool activity, and safety confirmations use their established domain integrations. A tool approval is a real decision with clear consequences and shared footer actions. Do not flatten pending, error, preview, approval-required, and completed activity into the same decorative status row.

Animate changes that clarify state or position. Do not add constant motion to messages, overuse success effects, or change the conversation's data flow as part of color polish.

## Shortcut menu

Use the same Section group logic and balanced row padding as settings. Keep descriptions, group labels, and shortcut notation aligned. Use shared `Kbd` instead of a local keycap recipe. Include the top and bottom edge clearance when checking spacing.

The menu remains usable with keyboard navigation and at narrow widths. Help text wraps where needed. Do not apply a 2px layer inset as the row's text padding, and do not make every shortcut into a tall independent card.
