# Review checklist

Use the relevant sections for a focused change. Use all sections and an explicit view/state ledger when the user asks for a full-system audit. This checklist does not require a full application audit for every prop edit.

## Hierarchy and shade

- Does each painted area have a clear Canvas, Panel, Section, Detail, floating, or state role?
- Are equivalent settings forms and workspace groups lifted in the same way?
- Are idle list rows transparent unless there is a real reason for a fill?
- Are Detail summaries grouped rather than split into a box per number?
- Are primary, secondary, foreground, muted, and state roles preserved?
- Does success read green and destructive read red?
- Are category foregrounds readable in light and dark?
- Are remaining borders meaningful rather than decorative?
- Are shadows restrained, with no bevel or clay treatment?

## Insets, corners, and alignment

- Is the layer inset separate from internal content padding?
- Do equivalent sibling Sections share edge alignment, inset, and radius?
- Are full-width nested contours derived from the real parent edge distance?
- Do control-sized children retain their appropriate smaller shape?
- Are top-left, top-right, bottom-left, and bottom-right painted consistently?
- Do gradients, selection, focus, and hover follow the same owner shape?
- Is the desktop structural border included when comparing panel/header contours?
- Is there only one owner for panel gutter, row padding, and sidebar spacing?
- Are action-to-edge clearances balanced at top, bottom, left, and right?
- Do headers, body, table columns, and footers align in width and baseline?
- Are large gaps intentional, rather than automatic margins or duplicated padding?
- Are labels centered without absolute positioning or per-label nudges?

## Components and states

- Is the existing component used through its actual public API?
- Are appearance props respected without conflicting visual classes?
- Are native controls or direct underlying-library imports limited to justified exceptions?
- Do icon-only controls have shared tooltips and concise accessible labels?
- Is keyboard focus visible and discreet, with correct dialog focus return?
- Are hover, pressed, selected, disabled, pending, read-only, invalid, and success states coherent where applicable?
- Do pending buttons retain width and pending switches retain their thumb?
- Do optimistic changes handle failure and avoid racing mutations?
- Do completing footer actions fill the row, share width, and follow the established order?
- Are irreversible actions destructive while neutral disconnect/cancel actions remain neutral?
- Do long labels and values wrap or truncate according to their role without clipping actions?
- Are true circles opted out of squircle shaping on every painted layer?

## Product-specific checks

- Mail rows, metadata, unread rails, important gradients, and selected surfaces work together.
- One-panel, two-panel, search, and all-inbox list paths preserve the same presentation contract.
- Virtualized lists retain measurement, focus, and scroll anchors after width changes.
- Empty reading panes show useful dynamic context without duplicating nearby navigation.
- Inline/full composer has a Section body and fully rounded inset Detail toolbar with no clipped final icon.
- Snippets use list-style grouping rather than inconsistent row cards.
- Calendar schedule has a rounded inset shell and a rounded nested weekday/all-day header group.
- Calendar arrows remain stationary across changing date labels.
- Calendar event-editor Sections share corners, padding logic, and edge alignment.
- Chat dock/floating layouts preserve input, transcript height, scrolling, and token-editor growth.
- Shortcut menu uses the shared row and keyboard-key treatment.
- Settings groups, DNS/table headers, connectors, labels, keys, and teams follow their intended form/list distinction.
- Billing uses the current product renderer, a prominent spaced usage bar, and consistent summary/rate geometry.
- Delivery metrics use grouped Detail summaries with no unexplained blank bands.
- Auth and onboarding show customer UI with real control behavior and relevant link/error states.
- Audience/template/campaign review preserves content, permission, status, and send boundaries.
- Unsubscribe confirmation, already-complete, invalid, and POST behavior remain correct.
- Landing retains marketing spacing, darker waitlist-field exception, restrained pricing, text footer wordmark, and safe local demos.

## Implementation and scope

- Did the fix reach the earliest shared owner of the defect?
- Were equivalent callers, recipes, examples, themes, and Paper nodes considered within scope?
- Were intentionally distinct roles preserved instead of normalized by matching hex values?
- Are data, provider, authorization, and cache contracts unchanged unless the task includes them?
- Does a new variant have a real reusable purpose, real caller, and showcase example?
- Is each local exception narrow and explained by an interaction constraint?
- Are generated palette files produced from their source rather than hand-edited?
- Were the actual final artifact and relevant states inspected?
- Are screenshots private-data-free and valid when linked in a PR?
- Are claims limited to the views, states, themes, and behavior actually checked?
- Are task-owned servers stopped while other tasks' services remain untouched?

Record unresolved issues as a concrete view, element, state, and mismatch. Avoid vague verdicts such as "needs polish" or "everything perfect" without evidence.
