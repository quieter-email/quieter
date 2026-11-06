# Foundations

## The intended character

Quieter is a working mail and calendar product. It should look modern, calm, precise, and useful at everyday density. It should not become playful, puffy, toy-like, heavily embossed, or a collection of floating cards. Familiar restrained product styling is a better starting point than novelty.

Shades establish hierarchy. Corners make grouping clear. Type and alignment make information readable. Shadows are secondary support. Add a boundary only when it communicates something the fill and spacing cannot.

## Surface roles

The default dark palette has these verified base values. Consume semantic tokens, not these literals in app code.

| Role | Token | Default dark | Meaning |
| --- | --- | --- | --- |
| Canvas | `canvas` | `#0A0A0B` | Application background and sidebar |
| Panel | `panel` | `#131315` | Main workspace, reading pane, settings panel, dialog shell |
| Section | `section` | `#1B1B1E` | Header tray, settings group, editor body, coherent content group |
| Detail | `detail` | `#26262A` | Inputs, secondary actions, selected items, attachments, nested summaries |
| Hover | `control-hover` | `#2E2E31` | Interactive hover state |
| Pressed | `control-active` | `#38383C` | Interactive pressed state |
| Floating content | `popover` | `#303034` | Menus, selectors, popovers, tooltips |

These roles are not instructions to stack all four backgrounds in every component. An ordinary paragraph does not need a Detail rectangle. A list does not need a separate Section behind each unselected row. A floating popup uses `popover`, even if it sits above Detail.

Light themes retain the roles but do not follow a mechanical brighter-is-higher rule. They use separated light values that keep controls visible. The live `styles.css` and brand theme definitions own those values. Do not invert the dark hex values, copy an old light screenshot, or patch every caller with `dark:` utilities.

## Keep the full semantic palette

| Meaning | Use |
| --- | --- |
| Ordinary content | `fg`, with `muted-fg` for supporting text |
| Most important completing action | `primary`, `primary-fg`, and primary state steps |
| Supporting filled action | `secondary`, `secondary-fg`, and secondary state steps |
| Fields and controls | `input`, `control`, and shared control states |
| Cards and floating content | Their named role and foreground pair |
| Highlighted menu item | Shared `accent` treatment |
| Positive state | `success`, with its matching foreground |
| Warning state | `warning`, with its matching foreground |
| Destructive action or error | `destructive`, with its matching foreground and states |
| Categories and user labels | `q-gray`, `q-blue`, `q-cyan`, `q-green`, `q-yellow`, `q-orange`, `q-red`, `q-pink`, `q-purple` |
| Necessary edges | `border`, `border-strong`, `ring` |

The default primary is vivid blue with violet in light mode and very bright near-white in dark mode. Brand themes may supply another primary. Keep primary actions primary. Do not make them gray to fit a quiet layout.

Destructive should read red. Current default dark uses `#F06A6A`. Success should read green, not a muddy yellow-green or teal. Use the shared tokens instead of tuning these colors per feature.

Keep category background and foreground roles distinct where available. Recent light-theme code uses `q-*-fg` for readable category text. Dark can alias that foreground to the category color. Shared Pills own their tint recipes. Do not keep using a raw category color as text when its light-theme value is intended for a fill.

Equal values do not make semantic roles duplicates. `secondary`, `control`, and `detail` can match now while remaining separate contracts. Remove aliases only after checking consumers, theme generators, CSS, assets, and marketing. Never eliminate primary, secondary, foregrounds, or state colors to achieve a four-color palette.

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

The default theme uses this shape system at a 16px root font size. Themes may alter the base geometry. Refer to the token, not a copied pixel constant.

| Role | Default | Owner |
| --- | --- | --- |
| Base `radius` | 8px | Theme |
| `rounded-xs` | 6px | Small established treatments |
| `rounded-sm` | 8px | Pills and other small shapes |
| `rounded-md` | 10px | Ordinary controls and standalone Detail surfaces |
| `rounded-lg` | 12px | Sender avatars, tabs, toggle rails, established small groups |
| `rounded-xl` | 14px | Header controls, menus, some compact toolbars |
| `rounded-panel` | 30px | Desktop main panel shell |
| `rounded-section` | 27px | Section shells and workspace header trays |
| Full-width Detail inset within Section | 25px | `Surface chrome="inset"` |

Panel is the theme's base radius plus 22px. Section derives from Panel minus 3px. The inset Detail surface derives from Section minus 2px. Do not calculate from an old screenshot that assumed a different border or inset.

Supported browsers apply `corner-shape: superellipse(1.825)` through the existing global rules. `squircle` reasserts that treatment locally. True circular pieces use `not-squircle` on every painted layer. A radio dot or switch thumb should remain a circle.

Consistency means the same role has the same contour. It does not mean a 10px input, 8px Pill, and 27px settings group must share a number. Within an event editor, sibling Section cards must share a radius and inset. A header control can keep its established 14px shape inside that Section.

For a full-width nested layer, the visual relation is outer radius minus the real edge distance. Count border, margin, and padding that move the painted edge. Use the shared derived radius. Do not use a random `rounded-3xl`, `rounded-full`, or per-corner patch to approximate it.

The current code includes larger radius steps for deliberate larger shells. Their availability does not justify using them on ordinary settings groups. Switch tracks, slider dots, avatars that are truly circular, and compact status dots retain their intended round shape.

Some opt-in themes intentionally alter geometry. In the inspected definitions, Sand and Graphite use a 4px base radius and 10px row padding, Coffee uses an 8px base and 14px row padding, and Moss and Sage use a 14px base and 14px row padding. Their panel gutters also differ. These are theme choices, not inconsistencies to override with the default dark values.

## Insets and padding are separate

| Space | Current default | Purpose |
| --- | --- | --- |
| Desktop panel gutter | 8px | Separate workspace panels from Canvas |
| Narrow-screen panel gutter | 0 | Use the available viewport |
| Workspace header tray margin | 2px | Separate Section paint from Panel |
| Panel structural border on desktop | 1px transparent | Complete the 3px concentric edge relation |
| Header tray content padding | 14px | Align contents at the same visual 16px edge |
| Section-to-full-width-Detail layer inset | 2px | Show the nested shade without a thick frame |
| Standard nested summary content padding | 16px | Room around text and controls |
| Settings row vertical padding | 16px by theme token | Balance row content and actions |
| Settings row horizontal padding | 24px, 16px at narrow widths | Balance the taller control against the side edge |
| Plain dialog header, body, footer | 16px | Shared text and action alignment |
| Composer header and body horizontal inset | 16px | Align recipient, subject, and editor content |

Spacing uses the established 4px Tailwind scale with half steps. Repeated spacing lives in shared layouts, not a second feature-specific scale.

A narrow 2px layer gap does not mean text sits 2px from the edge. The nested surface has its own content padding. Conversely, a 24px text inset does not mean every background layer needs a 24px border-like frame.

Prefer the small layer inset for full-width header trays, stacked summaries, calendar headers, and composer footers. Use ordinary content spacing for independent cards, pricing plans, reading content, and unrelated sections. The landing pricing layout is not an inset workspace toolbar.

Sibling sections in one view share their background edge, layer inset, and radius. Compare the actual parent edges, not only the child text. Avoid accidental double padding from a wrapper plus `SettingsRow`. Compare nested action clearance as well as raw inset values. A 32px control adds height to a row, so identical x/y padding does not always look balanced.

Large empty gaps need a reason. Check `justify-between`, automatic margins, `flex-1`, minimum heights, invisible children, retained loading shells, duplicated gutters, and wrapper padding before changing the spacing scale. Preserve intentional writing room, calendar time scale, and marketing section height.

## Type and alignment

Use self-hosted Geist for interface text and Geist Mono for established code, token, and numeric treatments. Keep the shared line heights and tracking.

| Utility | Size | Typical use |
| --- | --- | --- |
| `text-display-lg` | 56px | Deliberate marketing display |
| `text-display-md` | 44px | Display |
| `text-title-lg` | 32px | Large page heading |
| `text-title-md` | 24px | Page heading |
| `text-metric` | 28px | Usage total or prominent metric |
| `text-title-sm` | 20px | Compact page heading |
| `text-body-lg` | 16px | Workspace heading, prominent copy, large control |
| `text-body` | 14px | Body copy |
| `text-body-sm` | 13px | Dense UI, labels, default controls |
| `text-caption` | 12px | Metadata |
| `text-micro` | 11px | Small labels and Pills |

Use medium weight for headings and row labels, regular weight for supporting text. Large bold type is not a default way to create hierarchy. Marketing can have a display headline while feature and pricing text stays restrained.

Use shared `Text` for repeated treatments. Its `size` prop names are not identical to the utility names. Read the actual API. Do not wrap every specialized semantic text node solely to use `Text`.

Controls center text and icons through their own flex layout, size, and line height. Pills use content padding rather than a fixed height that crops the label. Use `Button size="auto"` for a genuinely multiline action. Fix the owning component when several labels sit off-center. Do not nudge each label with `top`, transforms, or asymmetric padding.

Allow descriptions, instructions, errors, and message text to wrap. Truncate compact workspace titles and row titles where appropriate. Use `min-w-0` on shrinking content, `shrink-0` on fixed actions, and a real available-width boundary. Preserve information through tooltips or a detail view when truncation hides something needed.
