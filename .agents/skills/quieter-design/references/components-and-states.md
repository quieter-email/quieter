# Components and states

## Select the existing component

Import from public `@quieter/ui/...` exports. The source directory name does not guarantee a public import or a current API. Inspect the export and real caller before copying an example.

The catalog below describes each family's design job. Variant names are examples of the inspected contract, not a substitute for reading its current props.

| Family | Existing owner | Decision rule |
| --- | --- | --- |
| Actions and navigation-shaped actions | `Button`, `LinkButton`, `buttonVariants` | Use action semantics for mutation and link semantics for navigation |
| Static shade groups | `Surface`, `surfaceVariants` | Use Panel, Section, or Detail by hierarchy |
| Main app panel and header | `WorkspaceSection`, `WorkspaceHeader` | Own responsive gutters, panel clipping, and the header tray |
| Side panel and sliding dock | `WorkspaceSidebar`, `WorkspaceDock` | Own sibling geometry and coordinated width motion |
| Settings | Shared `settings-layout` exports and app anchor adapter | Own grouped rows, padding, label/action alignment, and settings search anchors |
| Ordinary text | `Text` | Own repeated type, weight, color, and truncation |
| Icons | `Icon`, established icon collection | Own size, tone, and supported animation |
| Fields | `Field`, `FieldLabel`, `FieldError`, `Fieldset` family | Associate labels, help, errors, and validation state |
| Single and multiline text entry | `Input`, `Textarea`, `TextField` | Choose the established field behavior and size |
| Compound entry | `InputGroup`, `InputAddon`, attached input/select chrome | Paint one enclosing control, not multiple adjacent boxes |
| Structured entry | `TokenField`, product editor integration | Preserve actual editing and keyboard behavior; inspect the current editor package rather than assuming a shared UI export |
| Numeric input | `NumberField` | Keep stepper controls, formatting, and input geometry together |
| Choice input | `Select`, `SearchableSelect`, `Autocomplete` | Use the correct search and selection behavior, with a shared popup |
| Date and time | `Calendar`, `DatePicker`, `TimePicker`, date/time preferences | Use user date/time conventions and shared triggers |
| Schedule | `Schedule` | Own calendar grid, event geometry, headers, and interaction |
| Boolean | `Switch`, `SwitchThumb` | Familiar track and thumb for an immediate setting |
| Checkable item | `Checkbox` | Selection or opt-in, including indeterminate state where applicable |
| One-of-many | `RadioGroup` | Use an actual mutually exclusive choice |
| Pressed mode or segmented choice | `Toggle`, `ToggleGroup`, button `chip` or `option` | Preserve pressed state and a quiet selection treatment |
| Tab navigation | `Tabs`, `SelectionIndicator` | Distinguish the selected page without inventing another control style |
| Slider | `Slider` | Keep thumb, track, range, keyboard support, and state as one control |
| Status or category | `Pill` | Use state tones for state and categorical tones for labels |
| User and sender identity | `Avatar`, image/fallback parts, `SenderAvatar` | Prefer sender-specific sizing for mail; preserve robust fallback |
| Modals | `Dialog`, `AlertDialog`, `FullPageDialog` | Ordinary dialog, irreversible confirmation, or full-page editing respectively |
| Mobile panels | `Drawer` | Use shared mobile geometry and dismissal behavior |
| Anchored UI | `Popover`, `Tooltip`, dropdown/context menus | Use floating fill, shared edges, motion, and keyboard management |
| Searchable command surface | `CommandMenu` | Shared command hierarchy, shortcut presentation, and selection behavior |
| Completing actions | `ActionFooter`, overlay-specific footers | Full-width, equal-share actions in consistent order |
| Toolbars | `Toolbar`, button/group/link/input parts | Actions that edit or operate content, distinct from completing footers |
| Mail editing | `composer-chrome` exports | Shared field group, writing frame, prompt frame, and action bars |
| Mail presentation | `MailListRowDetails`, row recipes, selection/metadata parts | Shared row geometry and responsive information order |
| Thread navigation | `ThreadRail` on current main | Shared proximity, drag, highlight, keyboard, and reduced-motion behavior |
| Shortcut | `Kbd`, button `keycap` for interactive demos | Static key notation differs from an actual clickable demo key |
| Disclosure | `Accordion`, `Collapsible` | Preserve expansion semantics and layout behavior |
| Hierarchy | `Breadcrumbs` | Use navigable hierarchy, not decorative chip rows |
| Scrolling | `ScrollArea` | Keep the content's scroll owner and overflow behavior deliberate |
| Visual separation | `Separator` | Use for a meaningful division, not after every row |
| Data | `BarChart`, `Progress` | Reuse established chart/track treatment and accessible values |
| Feedback | toast/toaster, `SpinnerIcon`, `SuccessPulse` | Use transient feedback where it explains real state |
| User color | `ColorPicker`, `ColorSwatch`, `ThemePicker`, color-mode control | Keep user-supplied colors and app theme choice distinct |
| Brand | `Brand` and established assets | Preserve artwork proportions and source ownership |

## Button appearance

| Need | Use |
| --- | --- |
| Main completing action | Default primary button |
| Supporting filled action | `variant="secondary"` |
| Irreversible deletion, removal, or reset | `variant="destructive"` |
| Quiet inline or icon action | Established `ghost` usage, with clear hover and keyboard state |
| Intentional edged control | `outline`; do not use it as a generic footer fallback |
| Header action with Detail-like fill | `variant="toolbar"` |
| Header control geometry independent of fill | `chrome="toolbar"` |
| Large selectable setup option | `variant="card"` |
| Compact optional field toggle | `variant="chip"` with `aria-pressed` |
| Segmented option | `variant="option"` with `aria-pressed` |
| Settings or command result | Existing `result` recipe and active state |
| Inline editable title | Existing `inline-edit` only for its actual inline-edit interaction |
| Large clickable keyboard demo | `keycap` |
| Dark atmospheric backdrop | Existing `overlay` treatment when the established caller needs it |

The default button is 32px high with 13px text. The default icon-button box is 32px, with a 16px icon. `sm`, `xs`, `compact`, `lg`, icon sizes, and `auto` exist for different density needs. Do not change a screen's density by selecting smaller controls just to solve a radius defect.

Use `size="auto"` for multiline actions. `pending` on a normal button preserves its width while showing progress. It is useful for an actual action that must complete. It is not a reason to add a spinner to every boolean preference.

`chrome="toolbar"` is a shape choice. A primary header action remains primary with toolbar geometry. Controls inside its popup revert to normal popup control geometry. Do not apply header rounding to every menu item.

## Action footers

Overlay footers, compact panel completion rows, and drawers fill the available content width. A single action spans the row. Multiple actions share equal width. Three actions remain side by side when their labels fit and wrap only when necessary.

Use the shared footer or `ActionFooter`. Put action buttons or links directly inside it. Do not add a spacer, right-align content-width buttons, wrap each action in an equal-width workaround, or override its fill behavior.

Order is secondary or Cancel first, destructive next if present, completing primary last. There is one primary completing action. A lone Done, Close, or Reload is primary. Cancel is secondary. Delete, Remove, Reset, and other irreversible actions stay destructive, including a button that opens the confirmation. Do not disguise them as primary or ghost to satisfy the one-primary rule.

This rule applies to completion rows. Mail-formatting toolbars, menus, row actions, and ordinary inline controls follow their own layout.

## Destructive meaning

Red signals actual loss or an error. Deleting a contact, campaign, key, account, mailbox, or saved item warrants destructive treatment when irreversible. Disconnecting a connector, closing a panel, canceling a draft operation, clearing a filter, and leaving a view are not inherently destructive.

Follow the action's consequence, not whether its verb sounds negative. A destructive confirmation can explain what is lost while keeping its secondary escape action visible.

## Inputs and compound controls

Inputs use the field and size APIs. They do not need an extra bordered wrapper unless the shared compound control owns it. Use `Input chrome="attached"` and an attached select inside `InputGroup` for one mailbox address control.

The group owns the fill, outline, outer corners, and compound focus/error state. Children own editing. Avoid double outlines, tiny rounded seams, doubled padding, and two independently rounded halves. The control's painted focus follows the whole shape.

Use `chrome="ghost"` for the established inline editor interaction, not to make an ordinary field disappear. Keep read-only and disabled behavior distinct. A field's disabled state must not look like a placeholder for missing data.

Validation appears at the field boundary and remains associated with the input. Preserve normal help wrapping and error text. Do not show only a red outline with no usable explanation.

## Switches, toggles, and optimistic updates

Use a familiar switch. Default track is 44px by 24px, with a circular thumb. The off state uses the switch-track token and muted thumb. Checked uses the theme primary and its foreground. The small size remains available where already appropriate.

The pending API disables the existing switch and sets busy semantics while preserving the thumb. No spinner replaces it. For a safe reversible preference, update optimistically, reconcile server state, and roll back with visible error feedback. If an operation cannot safely be optimistic, disable the control until the response. Prevent duplicate or out-of-order mutations.

`Switch`, `Checkbox`, and `Toggle` are different interactions. Do not choose the one that happens to look easiest to restyle. Segmented choices show a pressed/selected option through the shared indicator. Keep their group shape and individual option shape distinct.

## Pills and category colors

Pills are content-sized, with centered labels and intentional padding. They are not buttons unless the interaction supplies real button semantics. Keep the shared size and tint recipe. Do not use fixed heights, local text offsets, or a unique chip style for each feature.

Map domain status to generic tones in app code. A manager role can map to an existing tone without a new `access-manager` variant. Use `success` for positive state and `green` for a green category. Custom user label color passes through the supported `customColor` API.

Read current foreground pairs in light themes. A shared category or theme correction must cover mail labels, settings labels, calendar categories, menus, and sample compositions that consume it.

## Focus and overlay behavior

Use discreet existing 1px keyboard indicators. Do not add 2px or 4px rings and offset halos everywhere. Do not globally remove outlines or focus visibility.

Opening a dialog does not justify drawing an oversized ring around the default element. Preserve focus entry, focus containment, Escape, return focus, and a visible keyboard route. Shared editor frames may distinguish pointer entry from Tab navigation. Do not duplicate that tracking in every consumer.

Inputs can match `:focus-visible` even after pointer interaction. Inspect the actual component behavior before declaring a dialog autofocus issue fixed by deleting its ring. A compound editor may signal focus at the container rather than every inner token.

Use a concise accessible label and shared tooltip for every icon-only action. Decorative icons are hidden from assistive technology. Disabled tooltips may need the existing wrapper pattern. Tooltips and anchored popups use `popover` fill on current main, with shared elevation and subtle edge treatment.

Keep a popup anchored to a stable trigger. Recent shared `anchoredTriggerClassName` avoids scaling the trigger in a way that moves its popup. Do not rebuild an anchor animation locally.

## State completeness

For the changed component, inspect the states that actually apply. The relevant set can include default, hover, active, selected, focused, disabled, read-only, pending, invalid, empty, success, and destructive.

State must be visible without layout jitter. A selected label must stay centered. A pending action must not push adjacent actions. An invalid field must not grow an extra border outside its allocated box. Long localized text must wrap or truncate according to its role.

Use the shared indicator, spinner, and success treatment rather than inventing per-feature feedback. Avoid animating static information solely because an animation component exists.
