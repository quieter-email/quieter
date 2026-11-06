# Implementation rules

## Ownership

Follow the repository's [design-system policy](../../../../AGENTS.md#design-system) and [package boundaries](../../../../AGENTS.md#boundaries). Use the guide's [appearance and layout contract](../../../../docs/design-system.md#appearance-and-layout) when choosing the owner of a change.

A wrong fill across equivalent controls points to the shared component. A clipped trailing action caused by its available width points to the product layout. A correctly shaped Section that looks wrong only in one theme points to the theme definitions. Find the first incorrect decision instead of compensating in each consumer.

## Choose the smallest existing contract

Apply the guide's [component selection process](../../../../docs/design-system.md#appearance-and-layout) before adding a variant or local exception. A measured calendar position and a structured mail-search token input have interaction constraints. A preferred gray or padding value does not.

Reusing a visual component does not prove two rendering paths are equivalent. Compare optional metadata, derived labels, permissions, and state with the established caller. A mail preview that omits attachment names or an empty pane that bypasses mailbox scope is incomplete even if its pixels match.

## Props own appearance

The guide defines which appearance belongs in [props and shared recipes](../../../../docs/design-system.md#appearance-and-layout). These compositions show how separate visual roles fit together without rebuilding those recipes.

For static nested information, compose the existing surfaces:

```tsx
<Surface padding="compact" variant="section">
	<Surface chrome="inset" variant="detail">
		<Summary />
	</Surface>
</Surface>
```

The outer 2px layer inset and inner 16px content padding have separate owners. Do not put another padded card around this combination just to get the same effect.

For a finishing row, put actions directly in the shared layout:

```tsx
<ActionFooter>
	<Button variant="secondary" onClick={onCancel}>Cancel</Button>
	<Button variant="destructive" onClick={onDelete}>Delete</Button>
	<Button onClick={onSave}>Save changes</Button>
</ActionFooter>
```

This illustrates ordering and fill behavior, not a requirement to add Delete to every form. Use the overlay's own footer when available.

Cursor treatment follows the shared interactive owner or established recipe. Avoid blanket `a[href]`, router-link, or clickable-element rules that assign `cursor-pointer`. Same-view links need `cursor-default` while retaining navigation semantics. Make any pointer exception for a clear different-page destination deliberately; do not scatter caller overrides across equivalent controls.

## Layout and clipping

Use flex and grid for ordinary controls, fields, rows, and text. Align through shared height, line height, padding, and layout. Avoid absolute x/y values, pixel nudges, translations, or manually offset icons to fake centering.

Measured positioning is valid for floating windows, dragging, virtualized rows, calendar events, popover anchors, and graphics. Keep the measurement, clipping, and resize lifecycle at the owner. Do not spread derived positions across unrelated callers.

When a toolbar clips, inspect intrinsic width, flex shrink, `min-w-0`, wrapping policy, outer margins, parent padding, and the clip boundary. When corners do not match, inspect every painted layer, including overlays, gradients, pseudo-elements, borders, and corner-shape inheritance.

Use `overflow-hidden` where a shell actually owns rounded clipping. Do not indiscriminately clip popup content, focus rings, draggable affordances, or an editor's interactive tools. A screenshot that hides the overflow does not prove the layout is fixed.

Reserve enough space for changing labels where pointer stability matters. Calendar arrows, pending buttons, counters, and conditional metadata should not shift the adjacent action on every update. Avoid global fixed widths when the stable region is local.

## Themes, tokens, and merging

Use the guide's [theme-generation contract](../../../../docs/design-system.md#colors) and [type-scale merging instructions](../../../../docs/design-system.md#type). Keep token values and generator commands there rather than maintaining another specification in this skill.

Keep semantic foreground pairs, category foregrounds, hover, pressed, invalid, and focus states valid across themes. Do not fix dark while leaving light or an opt-in brand palette unreadable. A shared default change should be reviewed against representative consumers rather than patched back at each caller.

## State and data flow

Follow the repository's [security and isolation](../../../../AGENTS.md#security-and-isolation) and [code-style rules](../../../../AGENTS.md#code-style) for state ownership, error handling, copy, and sensitive data.

During visual work, preserve the difference between unavailable, permission-limited, pending, empty, and failed data. A polished empty state must not disguise a failed query. A small recent-message card must retain the same authorization and enrichment contract as the full view.

## Motion and interaction

Use existing shared motion and current app orchestration. Match the type of change. Feedback, overlay entry, layout resize, scrolling, and a switch thumb do not need the same animation.

Preserve reduced motion, interrupted transitions, focus, scroll anchors, and width-measurement timing. Avoid bouncy motion on ordinary settings or controls. Do not add an animation merely to make a static view look more finished.

A dock and its adjacent content resize together. A virtual list updates its measurements at the appropriate phase. An anchored trigger does not scale in a way that moves its popup. Shared selection paint inherits the element's shape. These rules belong in the shared owner, not a useEffect in every consumer.

## Global changes and scope

For a color or shared component change, find imports, exported recipes, CSS consumers, theme generation, screenshots/spec examples, and product compositions. Update equivalent consumers together. An intentionally different semantic role is not automatically a missed caller.

If the user asks for Paper first, make the experiment concrete there before implementing code. If the task covers both, synchronize both. If a service or design file is unavailable, repair access when possible and report the actual gap. Do not claim it changed because the source changed.

Report the shared owner changed, callers that inherit it automatically, callers migrated explicitly, and intentional exceptions that remain. Do not undertake an unrelated visual overhaul as part of a narrow bug fix.

## Verification and delivery

Use the repository's [verification and delivery policy](../../../../AGENTS.md#finish) and [local-development rules](../../../../AGENTS.md#local-development-and-debugging). The guide owns [manual component verification](../../../../docs/design-system.md#review-and-manual-verification). Use [Paper and visual verification](paper-and-verification.md) for design-specific parity checks and evidence.
