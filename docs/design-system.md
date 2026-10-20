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
| Working compositions | `apps/web/src/features/design-system/components/design-system-showcase.tsx` |
| Settings anchors and domain wrappers | `apps/web/src/features/settings/components/settings-layout.tsx` |
| Motion orchestration | `apps/web/src/features/motion/` |

Before changing a UI, read the relevant component and its closest existing caller. A component's actual props are the contract. Do not assume APIs from upstream shadcn examples match this codebase.

## Choosing a component

| Need | Use |
| --- | --- |
| Action or button-shaped link | `Button`, `LinkButton` |
| Selectable setup card | `Button variant="card"` |
| Compact toggle chip or segmented option | `Button variant="chip"` or `variant="option"` with `aria-pressed` |
| Icon action | Icon-sized `Button`, concise `aria-label`, `IconButtonTooltip` |
| Field | `Field`, `FieldLabel`, `Input`, `Textarea`, validation components |
| Compound mailbox address | `InputGroup`, `Input chrome="attached"`, `InputAddon`, attached `SelectTrigger` |
| Choice or boolean | `Select`, `Checkbox`, `Switch`, `RadioGroup`, `Toggle` |
| Category or status badge | `Pill`, with domain-to-tone mapping in the app |
| Modal, destructive confirmation, mobile panel | `Dialog`, `AlertDialog`, `Drawer` |
| Overlay finishing actions | Shared overlay footer or `ActionFooter` |
| Workspace panel | `WorkspaceSection`, `WorkspaceSidebar` |
| Settings | Shared `settings-layout` components; app wrappers add anchors |
| Composer | `composer-chrome` components |
| Tokenized editor | `TokenField` |
| Menu, tooltip, popover | Shared menu, tooltip, popover components |

Settings feature code imports its local `settings-layout` adapter when it needs anchored rows or sections. The adapter re-exports shared components and adds search-anchor behavior; it does not define another visual system.

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

Use the custom type scale on semantic HTML or the shared text components. Direct semantic headings with type utilities are supported; wrapping every text node in `Text` is unnecessary.

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

The type tokens include line heights and heading tracking. Prefer those defaults before adding leading or tracking. `font-sans` uses Geist and `font-mono` uses Geist Mono. New scale steps must also be registered in `lib/cn.ts` so text colors do not evict font sizes during merging.

### Colors

| Role | Tokens |
| --- | --- |
| Main canvas and text | `bg`, `fg` |
| Raised workspace and panels | `bg-raised`, `bg-surface` |
| Cards and popovers | `card`, `card-fg`, `popover`, `popover-fg` |
| Fields and interaction ladder | `input`, `control`, `control-hover`, `control-active` |
| Main action | `primary`, `primary-fg` |
| Secondary action | `secondary`, `secondary-hover`, `secondary-active`, `secondary-fg` |
| Muted content and menu highlights | `muted`, `muted-fg`, `accent`, `accent-fg` |
| State | `success`, `warning`, `destructive`, with their foreground pairs |
| Edges and focus | `border`, `border-strong`, `ring` |
| Categorical colors | `q-gray`, `q-blue`, `q-cyan`, `q-green`, `q-yellow`, `q-orange`, `q-red`, `q-pink`, `q-purple` |

Use state colors for state, and categorical colors for labels or categories. A role such as mailbox manager maps to a generic Pill tone in the app. It does not need a second identical style called `access-manager` in the shared package.

Semantic aliases such as `card` and `bg-surface` can share values while serving different roles. Preserve those roles. Unused speculative aliases can be removed after checking all consumers, including CSS, theme code, generated assets, and the landing page. There is no requirement to use every token or keep every possible component variant.

Themes own their colors. Avoid per-caller dark-mode color patches and feature-local copies of the palette. Graphics, external brand artwork, user-selected label colors, and rendered email content have separate color requirements.

Named brand palettes are defined once in `lib/brand-themes.ts`. Run `vp run generate:brand-palette-css` after changing them, and commit the resulting CSS. `vp run generate:assets` also regenerates that CSS before rendering artwork. Do not edit `brand-palettes.generated.css` directly. Silver's `cssInk` supplies a text color while its `ink` remains the artwork's SVG gradient.

### Space and shape

Spacing uses the existing Tailwind scale with a 4px base, including half steps. There is no separate named spacing scale to invent. Repeated settings and workspace spacing belongs in those shared layouts. Unique viewport constraints and measured positions may use layout values without becoming global tokens.

The shared radius ladder is `xs` 8px, `sm` 10px, `md` 12px, `lg` 14px, and `xl` 16px. Larger existing steps remain available for intentionally larger shells. Controls own their radii; callers should not make the same checkbox rounder in one toolbar. Circular shapes can use `rounded-full`.

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

This pass changed 38 source files. It removed redundant menu component layers, reused the trigger interaction and delivery-tone recipes, replaced copied list-header/attachment/setup controls with shared controls, and introduced automatic button height for repeated multiline actions. It also aligned status badges, destructive actions, icon tooltips and four settings finishing rows with existing shared APIs. Existing density, selected-card highlighting, editor behavior, data/cache logic and all landing sources remain intact. No lint restrictions or visual snapshot tests were added.

Checks passed for the changed source files. One existing composer warning remains for the effect that detects the keyboard modifier label. Chrome verification covered light/dark controls, multiline sample-key copying, narrow search dismissal, settings footers and onboarding playbooks. Screenshots use preview personas and sample data; provider-dependent send, domain-registration and key-creation actions were not executed for this styling pass.
