# Shared UI

Read [the design-system guide](../../docs/design-system.md) and the root policy before changing shared components.

- Keep appearance in this package. App callers should select an API, not reconstruct the component's styles.
- Search neighboring components before adding a class recipe. Reuse `buttonVariants` for button treatments on close/trigger elements and `inputVariants` for field treatments. Preserve the underlying element's accessibility and interaction behavior.
- Add a variant only when it represents a useful shared treatment. Use ordinary layout composition for positioning. Do not add a variant for each feature name or preserve every historical difference.
- Use `styles.css` for tokens and `lib/cn.ts` for custom Tailwind merge knowledge. Update both when adding a type-scale step. Avoid aliases that have no role or caller, and check references before removing tokens.
- Edit named brand palette values in `lib/brand-themes.ts` and run `vp run generate:brand-palette-css`. The imported CSS is generated; do not maintain another copy of the palette.
- Keep domain labels, permissions, queries, routing decisions, and app hooks outside this package. Accept data, callbacks, refs, and state as props.
- Expose new components in `package.json` and demonstrate reusable APIs in the app's `/design-system` page. Show a real supported composition, without bypassing the component's styles to make the example work.
- Inspect representative existing consumers when changing shared defaults. Keep primary, destructive, disabled, focus, invalid, and reduced-motion states coherent across themes.
