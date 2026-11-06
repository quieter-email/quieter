# Settings and other product patterns

## Settings are one system

Account, preferences, teams, members, labels, snippets, connectors, keys, domains, billing, usage, and delivery must share the same grouping logic. A settings page should not look older because its data is different.

Use the app's settings-layout adapter for anchored sections and searchable rows. It delegates visual appearance to the shared package. Use Section-filled `SettingsCard` or grouped rows for coherent form groups. Keep page title, description, section heading, card, and action hierarchy consistent.

Do not leave one ordinary settings group directly on Panel while its equivalent is lifted on Section elsewhere. Conversely, do not treat a mailbox-like list as a form group merely to put a background behind it. The labels manager keeps its established `SettingsCard` and shared inset rows. Transparent idle label rows do not mean removing that Section shell. Snippets follow their mailbox-like workspace list pattern. Determine whether the content is a grouped form, list, summary, or navigation before choosing the container.

## Settings row spacing

The row layout owns its vertical padding and responsive horizontal inset. At default desktop geometry it uses 16px vertically and 24px horizontally. Narrow content uses 16px horizontally. Themes can alter the shared row-padding token.

The intent is balanced clearance around text and actions. A 32px action contributes height, so equal raw x/y padding is not always equal visual spacing. Compare the action's outer box to every card edge. Do not make an action sit 8px from the right while the row has 24px above it.

Use one padding owner. Do not put a padded `SettingsCard` wrapper around a row that already owns its inset. Do not turn small shade gaps into row content padding. A multi-row group should have predictable first/last clearance and consistent gaps between its actual row contents.

Labels and supporting text stay together. Controls align within the row when space permits and stack deliberately when it does not. Long values, domains, email addresses, and translated labels must not push actions out of the card. Descriptions and errors wrap. Repeated controls align along a shared column where the form benefits from comparison.

Current main removed older plain-row and standalone-navigation variants from shared settings APIs. Do not recreate those deleted recipes because an old branch or snippet still shows them. Read the current `settings-layout.tsx` before implementing.

## Settings actions and data

Primary Save stays tied to the active theme. Pending and dirty state must reflect the actual form. Do not disable a whole settings view while one independent optimistic preference updates. Do not show success before an operation that cannot be optimistic has completed.

Disconnect is ordinarily a neutral supporting action. Delete, remove, reset, and other irreversible actions use destructive appearance. Explain actual consequences in a confirmation when required. Keep row actions distinct from the completing footer rule.

Show the ordinary user's data and permissions. Billing should not default to an internal unlimited plan. Teams, keys, authentication, connected accounts, and onboarding should depict the components and states customers see. Use representative sample data without real secrets, private mail, or development-only banners.

Include permission-limited, empty, pending, error, and success states when relevant. An unavailable permission is not the same as an empty account. A styling pass must preserve search anchors, navigation, and focus behavior.

## Tables and DNS

Table body uses the established Section grouping. Column headers can use one inset Detail tray. Align the header tray and body width, including its right edge. Labels align with the actual content columns and sit vertically centered in the header.

Use the current small shade inset and derived radius, not the old DNS experiment's isolated 12px/4px/8px geometry. The source owner decides the table's current contract. Do not revive a hardcoded radius because an early recap called it concentric.

Rows generally do not need decorative borders. Maintain readable column rhythm, row padding, status Pill placement, long value behavior, and copy actions. DNS host names, TXT values, TTL, priority, and verified state have different width needs. Keep the table usable at narrow widths through its established scroll or responsive treatment.

A status Pill should not touch the right edge or sit on a different baseline from its row. Check first/last rows and one-row empty-state replacements. Do not fix text alignment by absolutely positioning column labels.

## Billing and usage

Billing is part of settings. Use the same Section shape, row padding, input controls, action hierarchy, and Detail summaries. Preserve plan status, access limits, owner permissions, and loading/error distinctions.

Account billing and organization usage have distinct scopes in current main. `account-billing-panel.tsx` owns account billing, while the organization's view is titled Usage & limits. Do not move account actions into team settings or infer billing scope from an older board.

Use the actual `ManagedUsageSummary` renderer with sample data in the gallery. It must show the same composition as the product. An unlimited development account is not a reason to omit the production usage UI from the component reference.

Totals, balance, overage, and related numbers can share one Detail summary inside the Section. Avoid a separate card for each number. Keep labels close to values, use the established metric type, align numeric comparisons, and retain units and billing-period context.

The segmented usage bar is a main information element. Give it room above and below. Align its allocated track width with the summary and legend structure. Use system-appropriate rounded ends, not an exaggerated capsule and not a square slab. Segments meet cleanly inside one clipped track. Do not round each segment or distort values to make zero usage visible.

The final user correction asked for deliberate spacing around this bar. A small nested layer gap does not mean the chart should touch the summary or legend. Use the real billing renderer's geometry, not the generic small `ProgressTrack`, to reproduce the usage chart.

Legend colors and values map to the same categories as the bar. Text stays readable in every theme. Responsive columns preserve category/value association. Zero amounts, a nearly full balance, overflow/overage, and absent categories need coherent rendering.

Rate summaries, allow-overage settings, overage limits, alert thresholds, and Save actions use the existing controls and groups. Do not give billing cards a larger radius than all other settings. Avoid giant gaps introduced by `justify-between`, fixed-height wrappers, or extra margins between totals and activity.

Do not change billing math, prices, credits, or entitlement semantics while restyling. Product content comes from the domain contract, not the marketing screenshot.

## Delivery overview

Place related headline counts together in one inset Detail group inside Section. Do not create a separate box per number. The activity heading can use the same Detail language. Keep a deliberate but modest gap between summary, heading, graph, and supporting counts.

Use real units, period, and time zone labels. Keep chart and legend colors semantically consistent. Do not label server acceptance as proof of inbox placement or tracking activity as proof a person read a message. Existing explanatory tooltips are part of the product behavior.

Keep event types and filters consistent with their data source. Empty activity is not a chart crash. Handle zeros without giant placeholder heights. Use the shared chart rather than rebuilding its controls or tones in each delivery surface.

## Authentication and onboarding

Public auth and onboarding use the same tokens, type, controls, actions, and corner logic as the product. Atmospheric artwork or shaders can frame the form, but must preserve readable text, input contrast, and a stable fallback.

Design the actual normal-user paths. Include relevant sign-in, verification, account creation, recovery, invitation, setup, error, and completed states. Do not substitute a local preview account picker, debug login, developer secrets, or backend configuration page for the customer UI.

Fields, password controls, validation, and completing actions use shared components. Preserve correct labels, keyboard flow, paste, autofill, password managers, return navigation, and expired-link behavior. A visual change must not merge identity OAuth with Gmail access or expose credentials in screenshots.

Onboarding setup options use existing selectable cards and progress where appropriate. Avoid a full set of new rounded boxes for a flow that already has a shared composition. Keep footer actions consistent and explain why a primary action is disabled when the user needs that information to proceed.

## Audiences, templates, and campaigns

These patterns come from the attached growth feature branch and were not present on the inspected main baseline. Check the [source and branch caveat](sources-and-decisions.md) before using them. Do not add a missing feature as part of unrelated design work.

Growth workspaces belong to the same product. They reuse Panel shells, inset Section headers, ordinary form controls, semantic status Pills, list behavior, and shared dialogs. They are not separate admin dashboards with a new density or palette.

Use the established shared app-domain wrappers for broadcast content instead of duplicating them in audiences, templates, and campaigns. Lists, detail pages, contact/import dialogs, segment choices, content editing, review, queueing, and delivery states retain their domain hierarchy.

Preserve differences between draft editing and a sent/queued campaign. Review should expose the resolved recipients, message, and meaningful settings. Actual send is an authorized external operation, not something to execute just to check styling. Use safe preview data and do not let a playful demo enqueue real mail.

Audience unsubscribe defaults can be inherited by a campaign or explicitly overridden. Show inherited versus custom settings clearly through the existing shared field group. URL validation, immutable queued snapshots, and membership scope are behavioral contracts. Styling must not bypass them or create a second unsubscribe-policy model.

Template source, rendered preview, and any local-authoring integration must use the existing content contract. Do not rebuild the editor as a local textarea simply because an old board predates newer authoring controls.

## Public unsubscribe

The public campaign-unsubscribe view is also feature-branch-only in the inspected sources. It is distinct from the current mailbox unsubscribe action. Verify which path exists in the branch being changed.

The public confirmation view uses the same visual language with no app sidebar or sign-in requirement. Include confirmation, success, already-unsubscribed, invalid/expired link, and error behavior according to the current handler contract.

Opening a GET link must not itself unsubscribe a recipient. A confirm action performs the operation. Standard one-click POST is a separate native/server path and must keep its protocol behavior. Do not add mandatory login, client-only JavaScript, tracking, or a decorative step that breaks the actual mail link.

Use careful action semantics. Unsubscribe is a preference action, not account deletion. The confirmation and success text should explain the scope without exposing unrelated recipient information. A retry should be safe. Error UI should not reveal token or membership internals.

Custom unsubscribe destinations can be allowed by the sender's policy. Their UI must explain that custom handling still has to update the Quieter membership through the supported path. Never imply that a format-valid custom URL has been operationally verified.

## Landing page

Marketing uses shared tokens and controls. Its dedicated layout, illustrations, shaders, and storytelling have a different job from a dense workspace. Do not apply workspace header insets to every feature or pricing card.

Change `features/home` only when the request explicitly includes the landing page or an authorized shared change actually affects it. Preserve intentional full-height marketing sections. A product whitespace bug is not permission to collapse the landing page's section heights.

Feature groups and pricing need clear hierarchy with restrained type. Use reasonable content padding and distinct blocks rather than a stack of tiny-inset rows squeezed into a large table-like box. Plans should be comparable without oversized bold names or prices. Use live product facts rather than stale mock prices.

The waitlist field is a deliberate visual exception. Over atmospheric artwork, use the approved darker field treatment so it does not dominate the hero. Keep the actual form semantics, email validation, keyboard submit, progress, success, and failure behavior. Implement the exception at its existing marketing owner, not by darkening all product inputs.

The footer can have a large lowercase `quieter` wordmark with reduced opacity and a subtle fade. The user ultimately chose ordinary text. Do not make a new GPU shader a prerequisite. This decorative, `aria-hidden` artwork may use the existing absolute positioning behind the content. Keep real links and copyright in flow and readable over it. Prevent overlap with interactive targets and horizontal overflow.

Small demos can be quietly interactive. Shortcut keys can be clicked, snippets inserted, draft text sent in the demo, and labels changed. The interaction should be discoverable without a tutorial, use local deterministic sample state, and provide restrained feedback. Do not contact a provider, send actual mail, mutate user data, or create a second production app behind the marketing preview.

Preserve the real shader/artwork appearance where requested. Keep runtime effects bounded, responsive, reduced-motion aware where relevant, and independent from critical form rendering. A screenshot of a shader in Paper is acceptable when the effect does not need to be editable there.
