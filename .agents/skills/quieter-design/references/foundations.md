# Foundations

Use the design-system guide for the maintained [color roles and values](../../../../docs/design-system.md#colors), [type scale](../../../../docs/design-system.md#type), and [space and shape specifications](../../../../docs/design-system.md#space-and-shape). The [token source](../../../../packages/ui/src/styles.css) and [theme definitions](../../../../packages/ui/src/lib/brand-themes.ts) own their implementation. This reference explains how to apply those specifications.

## The intended character

Quieter is a working mail and calendar product. It should look modern, calm, precise, and useful at everyday density. It should not become playful, puffy, toy-like, heavily embossed, or a collection of floating cards. Familiar restrained product styling is a better starting point than novelty.

Shades establish hierarchy. Corners make grouping clear. Type and alignment make information readable. Shadows are secondary support. Add a boundary only when it communicates something the fill and spacing cannot.

## Surface roles

The surface ladder is not an instruction to stack all four backgrounds in every component. An ordinary paragraph does not need a Detail rectangle. A list does not need a separate Section behind each unselected row. Floating content follows its popup role even when it sits above Detail.

Light themes retain the roles but do not follow a mechanical brighter-is-higher rule. They use separated light values that keep controls visible. The live `styles.css` and brand theme definitions own those values. Do not invert the dark hex values, copy an old light screenshot, or patch every caller with `dark:` utilities.

## Keep the full semantic palette

Consolidating neutral shades must not collapse the semantic palette. Primary actions still need to stand out within a quiet layout. Destructive should read red, and success should read green rather than muddy yellow-green or teal. Apply those choices through the shared roles, not per-feature color adjustments.

Keep category background and foreground roles distinct where available. `q-*-fg` supports readable category text in light themes. Shared Pills own their tint recipes. Do not use a category fill as text merely because it was readable in dark mode.

Equal values can serve different roles. Palette simplification removes unnecessary visual steps, not primary, secondary, foreground, or state meaning. Follow the guide's alias rules when changing tokens.

External logos, email HTML, data visualizations, user-chosen colors, and shaders have legitimate separate color needs. Keep the exception at that boundary. Do not use it to introduce feature-local copies of the neutral palette.

## Borders, gradients, and shadows

Ordinary filled panels, settings groups, inputs, and row groups normally use their shade without a visible outline. A border should justify itself through structure or state.

Keep these meaningful edges when their shared implementation uses them:

- Calendar time and date grid lines.
- Outline component variants.
- Invalid input edges and discreet keyboard focus.
- Floating popup edges and elevation that distinguish the popup over any parent shade.
- Transparent structural borders that preserve geometry.
- Delimiters required for legibility in specialized editors or real external content.

Use the established `shadow-surface` and `shadow-elevation` treatments where their owners already use them. Do not add thick drop shadows to every group. Do not use inset shadows, bevels, or a collection of highlights to create a clay effect.

Do not delete semantic important-mail treatment while removing borders. Gradients must follow the complete row shape and state footprint. Clip painted layers to their actual owner, including pseudo-elements, so color does not leak into square corners or unrelated rows. A shader is artwork, not a replacement for clear UI contrast.

## Geometry has different jobs

Use the guide's role-based radius ladder and derived inner contours. Do not calculate from a screenshot that assumed a different border or inset. Consistency means the same role has the same contour, not that an input, Pill, and settings group share a number. Within an event editor, sibling Section cards share their shape while small header controls retain their control shape.

Keep the established corner shaping on every painted layer. A radio dot or switch thumb remains a circle even inside a shaped control.

For a full-width nested layer, the visual relation is outer radius minus the real edge distance. Count border, margin, and padding that move the painted edge. Use the shared derived radius. Do not use a random `rounded-3xl`, `rounded-full`, or per-corner patch to approximate it.

The current code includes larger radius steps for deliberate larger shells. Their availability does not justify using them on ordinary settings groups. Switch tracks, slider dots, avatars that are truly circular, and compact status dots retain their intended round shape.

Some opt-in themes intentionally alter geometry and gutters. These are theme choices, not inconsistencies to override with default dark values. Inspect the theme definitions when comparing them.

## Insets and padding are separate

A small shade-to-shade gap does not mean text sits against the edge. The nested surface has its own content padding. Conversely, comfortable text padding does not mean every background layer needs a broad border-like frame. Use the guide's spacing specifications for the actual values.

Prefer the small layer inset for full-width header trays, stacked summaries, calendar headers, and composer footers. Use ordinary content spacing for independent cards, pricing plans, reading content, and unrelated sections. The landing pricing layout is not an inset workspace toolbar.

Sibling sections in one view share their background edge, layer inset, and radius. Compare the actual parent edges, not only the child text. Avoid accidental double padding from a wrapper plus `SettingsRow`. A control contributes height to a row, so identical x/y padding does not always produce balanced action-to-edge clearance.

Large empty gaps need a reason. Check `justify-between`, automatic margins, `flex-1`, minimum heights, invisible children, retained loading shells, duplicated gutters, and wrapper padding before changing the spacing scale. Preserve intentional writing room, calendar time scale, and marketing section height.

## Type and alignment

Apply the guide's type scale, line heights, tracking, and text components. Large bold type is not a default way to create hierarchy. Marketing can have a display headline while feature and pricing text stays restrained.

The `Text` size prop names are not identical to utility names. Read the actual API when moving a treatment between semantic HTML and the shared component.

Controls center text and icons through their own flex layout, size, and line height. Pills use content padding rather than a fixed height that crops the label. Use `Button size="auto"` for a genuinely multiline action. Fix the owning component when several labels sit off-center. Do not nudge each label with `top`, transforms, or asymmetric padding.

Allow descriptions, instructions, errors, and message text to wrap. Truncate compact workspace titles and row titles where appropriate. Use `min-w-0` on shrinking content, `shrink-0` on fixed actions, and a real available-width boundary. Preserve information through tooltips or a detail view when truncation hides something needed.
