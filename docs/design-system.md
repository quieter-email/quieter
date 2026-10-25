# Design system

The product uses `@quieter/ui` for reusable appearance and app components for domain behavior. The live reference is `/design-system`. Start a local preview with `vp run dev`, then open that route. It uses sample data and does not require a connected mailbox.

## Where to look

| Concern | Source |
| --- | --- |
| Colors, typography, radii, shadows | `packages/ui/src/styles.css` |
| Named brand palettes | `packages/ui/src/lib/brand-themes.ts`, emitted to `brand-palettes.generated.css` |
| Tailwind class merging | `packages/ui/src/lib/cn.ts` |
| Component implementations | `packages/ui/src/components/ui/` |
| Public component imports | `packages/ui/package.json` exports |
| Working compositions | `packages/app/src/features/design-system/components/design-system-showcase.tsx` |
| Settings anchors and domain wrappers | `packages/app/src/features/settings/components/settings-layout.tsx` |
| Motion orchestration | `packages/app/src/features/motion/` |

Before changing a UI, read the relevant component and its closest existing caller. A component's actual props are the contract. Do not assume APIs from upstream shadcn examples match this codebase.

## Choosing a component

| Need | Use |
| --- | --- |
| Action or button-shaped link | `Button`, `LinkButton` |
| Selectable setup card | `Button variant="card"` |
| Compact toggle chip or segmented option | `Button variant="chip"` or `variant="option"` with `aria-pressed` |
| Icon action | Icon-sized `Button`, concise `aria-label`, `IconButtonTooltip` |
| Product icon | `Icon` from `@quieter/ui/icon`, with `size`, `tone`, and `animation` props |
| Product heading or text treatment | `Text`, with semantic `as`, `size`, `tone`, `weight`, and `truncate` props |
| Mail-list presentation | `MailListRowDetails` and `mailListRowFrameVariants`, with `stacked` or `adaptive` layout |
| Sender logo or fallback | `SenderAvatar`, with `sm` for mail rows and message headers |
| Field | `Field`, `FieldLabel`, `Input`, `Textarea`, validation components |
| Compound mailbox address | `InputGroup`, `Input chrome="attached"`, `InputAddon`, attached `SelectTrigger` |
| Choice or boolean | `Select`, `Checkbox`, `Switch`, `RadioGroup`, `Toggle` |
| Category or status badge | `Pill`, with domain-to-tone mapping in the app |
| Modal, destructive confirmation, mobile panel | `Dialog`, `AlertDialog`, `Drawer` |
| Overlay finishing actions | Shared overlay footer or `ActionFooter` |
| Workspace panel | `WorkspaceSection`, `WorkspaceSidebar` |
| Settings | Shared `settings-layout` components; app wrappers add anchors |
| Composer | `composer-chrome` components, including `ComposerActionBar` for reply actions |
| Tokenized editor | `TokenField` |
| Menu, tooltip, popover | Shared menu, tooltip, popover components |

Settings feature code imports its local `settings-layout` adapter when it needs anchored rows or sections. The adapter re-exports shared components and adds search-anchor behavior; it does not define another visual system.

Mail layout is a device preference owned by `features/settings/domain/mail-layout-setting.ts`. Two panels is the default. One panel reuses the existing mailbox and All inboxes list/detail paths, with selection kept in the route. Narrow screens always show one panel. Shared `MailListRowDetails` owns the row's responsive arrangement, type, and truncation. Wide rows align sender, address, subject, labels, metadata, and date in six columns, including when optional content is absent. Rows fill the list width with square corners and subtle separators. `mailListRowParts` owns the interactive row recipes. App code supplies formatted content and metadata slots. The virtualizer measures rendered row height and restores scroll and focus after a hidden list reappears at another width.

## Appearance and layout

Use props to select component appearance. Existing examples include `Button size="sm"`, `Button variant="destructive"`, `Input size="lg"`, `Input chrome="ghost"`, `Pill tone="success"`, and `Text tone="muted"`.

`className` remains useful for placement, responsive width, truncation, and external spacing. It should not counteract the chosen component API. `Input size="sm" className="h-8"` is contradictory. Use the default input size instead. Do not fix a mismatched button with padding, font, border, and color overrides.

For an unstyled HTML host with a specialized role, use an existing exported recipe when available. Dialog close elements use shared button variants while retaining the Close primitive. A custom editor's native control can remain native when replacing it changes the editing behavior.

Use `Button size="auto"` for multiline actions such as copying a revealed key or choosing a content-sized row. Put code typography on its `code` child and placement on the button. Do not rebuild a native button or override a fixed-height size to make it wrap.

When a design differs:

1. Try the standard component and established composition.
2. Remove a difference that has no clear interaction or hierarchy benefit.
3. Add a shared variant when a distinct reusable treatment is missing. Give it a real caller and a gallery example.
4. Keep a local exception only for a specific constraint the shared API cannot represent. Explain that constraint next to the code. Revisit it when it repeats.

Do not create a variant just to encode a feature name, another hex value, or one caller's preferred padding. Do not add lint rules to force adoption. Instructions, shared APIs, examples, and review guide this system; existing repository checks remain in place.

## Tokens

### Type

Use shared `Text` props for repeated product headings and text treatments. Specialized semantic HTML can use the same custom type scale directly. Wrapping every text node in `Text` is unnecessary.

| Utility           | Size | Use                                    |
| ----------------- | ---- | -------------------------------------- |
| `text-display-lg` | 56px | Large display text                     |
| `text-display-md` | 44px | Display text                           |
| `text-title-lg`   | 32px | Large page headings                    |
| `text-title-md`   | 24px | Page headings                          |
| `text-title-sm`   | 20px | Compact page headings                  |
| `text-body-lg`    | 16px | Prominent body text and large controls |
| `text-body`       | 14px | Body copy                              |
| `text-body-sm`    | 13px | Dense product UI and default controls  |
| `text-caption`    | 12px | Metadata                               |
| `text-micro`      | 11px | Small labels and pills                 |

The type tokens include line heights and heading tracking. Prefer those defaults before adding leading or tracking. `font-sans` uses self-hosted Geist and `font-mono` uses self-hosted Geist Mono in web and desktop. Compact workspace headings use 16px, dense UI uses 13px, and metadata uses 12px. Use medium weight for headings and row labels, regular weight for supporting text, and semantic colors to distinguish their roles. Truncate workspace and row titles to one line when space is limited. Help and instructions wrap normally, with 20px line height for settings descriptions. New scale steps must also be registered in `lib/cn.ts` so text colors do not evict font sizes during merging.

### Colors

| Role | Tokens |
| --- | --- |
| Main canvas and text | `bg`, `fg` |
| Raised workspace and panels | `bg-raised`, `bg-surface` |
| Cards and popovers | `card`, `card-fg`, `popover`, `popover-fg` |
| Fields and interaction ladder | `input`, `control`, `control-hover`, `control-active` |
| Main action | `primary`, `primary-hover`, `primary-active`, `primary-fg` |
| Secondary action | `secondary`, `secondary-hover`, `secondary-active`, `secondary-fg` |
| Muted content and menu highlights | `muted`, `muted-fg`, `accent`, `accent-fg` |
| State | `success`, `warning`, `destructive`, with their foreground pairs; destructive actions also use `destructive-hover` and `destructive-active` |
| Edges and focus | `border`, `border-strong`, `ring` |
| Categorical colors | `q-gray`, `q-blue`, `q-cyan`, `q-green`, `q-yellow`, `q-orange`, `q-red`, `q-pink`, `q-purple` |

Use state colors for state, and categorical colors for labels or categories. A role such as mailbox manager maps to a generic Pill tone in the app. It does not need a second identical style called `access-manager` in the shared package.

Semantic aliases such as `card` and `bg-surface` can share values while serving different roles. Preserve those roles. Unused speculative aliases can be removed after checking all consumers, including CSS, theme code, generated assets, and the landing page. There is no requirement to use every token or keep every possible component variant.

Themes own their colors. Avoid per-caller dark-mode color patches and feature-local copies of the palette. Graphics, external brand artwork, user-selected label colors, and rendered email content have separate color requirements.

App themes are defined in `APP_THEMES` in `lib/brand-themes.ts`, separately from the logo artwork collection. The palette defines surfaces, primary action colors, optional gradients, corner radii, workspace gutters, and settings row padding. Dark, Light, Eclipse, Lilac haze, and Porcelain keep the default geometry. Run `vp run generate:brand-palette-css` after changing themes, and commit the resulting CSS. `vp run generate:assets` also regenerates that CSS before rendering artwork. Do not edit `brand-palettes.generated.css` directly.

### Space and shape

Spacing uses the existing Tailwind scale with a 4px base, including half steps. There is no separate named spacing scale to invent. Repeated settings and workspace spacing belongs in those shared layouts. Unique viewport constraints and measured positions may use layout values without becoming global tokens.

Workspace panels are edge to edge below the desktop breakpoint, with no outer gutter, border, rounding, or shadow. Desktop panels keep an 8px gutter and their existing frame. Themes can adjust desktop gutters and settings row padding through shared tokens. `WorkspaceSection` owns the gutter for both full-page panels and grid cells. A layout wrapper that positions adjacent panels, including docked chat, imports `workspaceGutterClassName` from the same module and uses `--workspace-gutter`. Do not add another gutter between a trailing sidebar and the preceding panel's existing margin. Settings, Labels, Snippets and their loading states use the shared tokens. Internal cards and controls keep their own borders and rounding.

The default radius ladder is `xs` 8px, `sm` 10px, `md` 12px, `lg` 14px, and `xl` 16px. The ladder follows the active theme's base radius. Larger existing steps remain available for intentionally larger shells. Controls own their radii. Supported browsers apply the existing superellipse corner shaping globally, and `squircle` can reassert it within a local override.

Use `shadow-surface` for the existing workspace treatment and `shadow-elevation` where that elevated treatment is established. Ordinary component shadows are selected inside their implementation.

## Review and manual verification

Inspect the changed component in `/design-system` and its real product context. For visual API changes, check light and dark, a narrow viewport, keyboard focus, disabled and error states, and long content where relevant. Shared changes should be checked against representative existing consumers. Use screenshots with sample data for review. Do not write tests that freeze visual constants or copy.

Keep the landing page unchanged during this maintenance work. Its atmospheric visual treatment is intentional and has separate CSS. Global changes still need a check that they do not alter its existing controls.

## Audit on October 20, 2026

The initial inventory covered 188 app TSX files and the shared component and token sources. At the starting revision, 130 app files imported `@quieter/ui`; app JSX included 26 native buttons and six native inputs. There were no native selects or textareas, no direct Base UI/Vaul imports, and no raw palette or arbitrary literal color utilities in app TSX. These are inventory findings, not ongoing quotas.

The changes consolidate three overlay close-button recipes and repeated overlay chrome, move settings appearance into the shared package, replace three copied compound-address shells, simplify duplicate Pill tones, and replace ordinary custom setup/password controls with shared components. Named brand palette CSS now comes from the same definitions as the artwork. Unused shadow and motion tokens were removed, and the missing heading-font token was supplied. The live reference includes the resulting compositions and correct surface labels.

The audit also identified deliberate or unresolved specialized styling:

| Area | Treatment |
| --- | --- |
| Landing page | User explicitly excluded changes. |
| Structured search editor | Native content-sized token inputs and keyboard behavior stay local. |
| Sidebar navigation | Active surfaces, hover actions, and motion remain coordinated in local components; any later extraction must preserve those interactions. |
| Message rows and attachments | Selection overlays and mail actions retain domain-specific behavior. |
| Compose and floating assistant | Measured layout, drag controls, editor chrome, and recording feedback need context-specific review before changing. |
| Charts, color pickers, graphics, email HTML | Data-driven values and external content are valid exceptions. |

These are documented review areas, not blanket permission for new overrides. Follow the decision process above for future changes.

### Full-source follow-up

The follow-up read all 515 source and supporting files in its inventory, including client hooks/utilities, routes, CSS, shaders, shared components, brand generators, and email/SDK adapters. Six frontend metadata/configuration files were also reviewed. The [per-file coverage ledger](frontend-audit-2026-10-20.csv) records each decision, with no missing or duplicate source entries. Another 35 SVG assets were parsed structurally and recorded separately; raster artwork contains no frontend source code.

This pass changed 44 source files. It removed redundant menu component layers, reused the trigger interaction and delivery-tone recipes, replaced copied list-header/attachment/setup controls with shared controls, and introduced automatic button height for repeated multiline actions. It also aligned status badges, destructive actions, icon tooltips and four settings finishing rows with existing shared APIs. Workspace panels now share their responsive outer gutter, and docked chat uses the available height for its transcript instead of the floating chat height cap. Selected-card highlighting, editor behavior, data/cache logic and all landing sources remain intact. No lint restrictions or visual snapshot tests were added.

Checks passed for the changed source files. One existing composer warning remains for the effect that detects the keyboard modifier label. Chrome verification covered light/dark controls, multiline sample-key copying, narrow search dismissal, settings footers, onboarding playbooks and panel alignment. A browser-only mock conversation verified transcript scrolling in docked and floating chat without calling an AI provider. Screenshots use preview personas and sample data; provider-dependent send, domain-registration and key-creation actions were not executed for this styling pass.
