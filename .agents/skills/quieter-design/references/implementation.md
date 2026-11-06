# Implementation rules

## Ownership

| Owner | Owns |
| --- | --- |
| `packages/ui/src/styles.css` | Semantic colors, type scale, radius relationships, shared shadows, corner shaping |
| Theme definitions and generator | Named palettes and approved theme geometry |
| `packages/ui` component | Reusable appearance, internal spacing, size, fill, outline, radius, states, and component motion |
| Product component in `packages/app` | Domain data, authorization-aware state, interactions, formatting, placement, available width, and surrounding layout |
| App settings adapter | Search anchors and domain integration around shared settings appearance |
| Server packages and `@quieter/orpc` | Data access, validation, provider adaptation, mutations, and application contracts |
| Landing feature CSS | Marketing composition, artwork placement, shader presentation, and approved local exceptions |

Do not make `packages/*` depend on `apps/*`. UI and app code do not access the database directly. Keep provider details behind package boundaries. Appearance does not belong in an RPC adapter, and domain state does not belong in a generic control.

## Choose the smallest existing contract

Before adding a component or rendering path, trace one working path from data source through adapters and enrichment to the consumer. A reused visual component is not proof that optional metadata, permissions, derived labels, state, or behavior are equivalent.

Use this order:

1. Use the existing shared component and established composition.
2. Remove an unnecessary difference in the requested mock or current caller.
3. Add a named shared variant only for a distinct reusable interaction or treatment, with a real caller and a gallery example.
4. Keep a narrow local exception only where the shared API cannot represent the actual constraint. Explain the constraint beside the code.

An example exception is measured calendar placement. Another is a structured mail-search token editor whose native input behavior would change if replaced. A unique border radius, copied gray, or preferred padding is not a constraint. Do not import Base UI or Vaul directly from app code. Do not use a native select or rebuild an ordinary interactive control locally.

Repeated exceptions prompt a shared API review. Do not add stricter lint rules to compensate for unclear component contracts or an inconsistent implementation. Existing checks still apply.

## Props own appearance

Use `size`, `variant`, `chrome`, `tone`, and state props where the current component provides them. Do not negate those choices with `className`, wrapper styling, descendant selectors, inline styles, or a local CSS rule.

Allowed call-site layout includes placement, responsive width, external margin and gap, truncation, and available flex/grid space. Internal padding, fixed control height, type treatment, fill, border, corners, shadow, and interaction state belong to the owner.

These examples show the distinction:

```tsx
<Input size="default" className="w-full sm:w-72" />
<Button chrome="toolbar" variant="secondary">Refresh</Button>
<Pill tone="success">Verified</Pill>
```

Do not use `Input size="sm" className="h-8"` or restyle a secondary button with arbitrary primary colors. Read the API if a desired size or chrome seems missing.

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

Use named theme colors and the existing spacing/type/radius scales. Do not invent feature-local palette aliases, literal neutral colors, or a parallel spacing system.

Read `APP_THEMES` separately from the brand artwork collection. Theme values can affect palette, geometry, workspace gutters, and settings row padding. Dark, Light, Eclipse, Lilac haze, and Porcelain retain default geometry in the inspected definitions. Other themes can intentionally differ.

When theme definitions change, run `vp run generate:brand-palette-css` and commit the generated CSS with the source. `vp run generate:assets` also regenerates palette CSS before artwork. Do not hand-edit generated palette output.

Register a new type-scale step in `lib/cn.ts` if one is truly needed. Otherwise class merging can mistake a size for a color and drop it. Prefer existing steps before adding one. Use object syntax for conditional classes in `cn(...)`.

Keep semantic foreground pairs, category foregrounds, hover, pressed, invalid, and focus states valid across themes. Do not fix dark while leaving light or an opt-in brand palette unreadable. A shared default change should be reviewed against representative consumers rather than patched back at each caller.

## State and data flow

Use TanStack Query for server state and TanStack Store for complex client-only workflows. Keep domain types strict. Parse external values at the correct boundary, derive from existing schemas, and do not add optional-state bags or casts to silence missing contracts.

Reuse the established mailbox, organization, or audience scope in queries, cache writes, selections, drafts, and mutations. Include `mailboxId` wherever the contract requires it. A new preview or empty pane must not bypass ownership because it shows only a small amount of content.

Preserve disabled, permission-limited, and unavailable states. Do not pretend missing data is an empty success. Show failures through `toastError` according to the existing boundary. User-driven server messages are preserved where required. Unexpected failures use a generic retry message and Sentry reporting. Do not expose backend/provider/model names merely to make an error easier for the developer.

Keep secrets, identity tokens, Gmail access, and provider requests server-side as required by the repository. Use `@quieter/env` for configuration and linked SST Secrets where supported. Never add direct database or provider calls from UI to make a demo work.

Write product copy in plain language, using the user's task and familiar product concepts. Do not include implementation details unless they help a meaningful user decision. Do not use a middle-dot character or its entity/escape forms as a text separator. Use a styled separator element or a comma.

Consent remains browser-only. Analytics must not receive message content, search text, mailboxes, addresses, user identifiers, or private URL parameters. A design prototype is not an analytics exception.

## Motion and interaction

Use existing shared motion and current app orchestration. Match the type of change. Feedback, overlay entry, layout resize, scrolling, and a switch thumb do not need the same animation.

Preserve reduced motion, interrupted transitions, focus, scroll anchors, and width-measurement timing. Avoid bouncy motion on ordinary settings or controls. Do not add an animation merely to make a static view look more finished.

A dock and its adjacent content resize together. A virtual list updates its measurements at the appropriate phase. An anchored trigger does not scale in a way that moves its popup. Shared selection paint inherits the element's shape. These rules belong in the shared owner, not a useEffect in every consumer.

## Global changes and scope

For a color or shared component change, find imports, exported recipes, CSS consumers, theme generation, screenshots/spec examples, and product compositions. Update equivalent consumers together. An intentionally different semantic role is not automatically a missed caller.

If the user asks for Paper first, make the experiment concrete there before implementing code. If the task covers both, synchronize both. If a service or design file is unavailable, repair access when possible and report the actual gap. Do not claim it changed because the source changed.

Report the shared owner changed, callers that inherit it automatically, callers migrated explicitly, and intentional exceptions that remain. Do not undertake an unrelated visual overhaul as part of a narrow bug fix.

## Verification and delivery

Use Vite+ for installs, package management, and project scripts. Follow the active repository's branch, worktree, synchronization, commit, and PR instructions. A design skill does not grant permission to deploy, migrate production, send campaigns, or merge.

For routine copy, prop, token, CSS, or small wiring changes, inspect the diff and use a targeted check only to resolve real uncertainty. Do not automatically run full builds, full test suites, React Doctor, or another audit for every visual edit.

For substantial new behavior, state/data redesign, security, isolation, migrations, infrastructure, or a broad uncertain refactor, use the repository's full verification path. Add focused tests only for behavior that needs a safety net. Do not test exact copy, visual values, arbitrary defaults, or implementation mirrors.

Manually inspect changed visual treatments in the product, a representative gallery example, relevant light/dark and narrow contexts, and meaningful states. Use sample data. Once the relevant checks pass, stop repeating them unless something changed or a concrete concern remains.

Include screenshots in visual PR descriptions when capture/upload is available. Prefer before/after when it clarifies the change. Keep private data and secrets out. If screenshots cannot be included, state the actual reason. Report what was tested and its limits without claiming unobserved parity.
