# Choose pstack models

Use this policy for every harness and role, including skills invoked directly. The [repository preferences](preferences.md) hold shared model choices and consultation limits. The [client adapter](harnesses.md) owns native tools and personal override paths. The [setup steps](setup.md) own preference questions and role labels. Keep model choices out of bundled skill instructions.

## Resolve a role

1. Read the repository preferences and this harness's personal overrides. Honor an explicit task-specific choice first, then a personal role override, then a repository role override, then the repository's default for this harness. An explicit `inherit-parent` is an override. Apply personal effort, speed, and release overrides where present, otherwise use the repository preferences. Resolve pending choices when native discovery can verify them. Until then, inherit for unresolved roles. Use a legacy personal file only when the adapter allows it and its choices work in this harness.
2. Check the native delegation tool's accepted models and supported effort controls before the first explicit model selection in a chat. A provider catalog proves that an ID exists, not that the user has access. Preserve provider-qualified IDs and native agent names.
3. Apply the saved release preference below. Keep the exact resolved ID separate from its approved model series. A model series is a product line within a provider, not the provider's entire catalog.
4. Pass only supported native arguments. `auto` and `inherit-parent` mean omit the model override. OpenCode's `agent:<name>` means select that configured native agent, not pass a model argument.

When neither repository preferences nor personal overrides configure a role, it inherits the parent in every harness, including Cursor. An unconfigured panel uses two `inherit-parent` entries. The cross-judge pool defaults to one `inherit-parent` entry. Preserve explicit panel sizes, including repeated models. Several agents using one model provide separate perspectives, not model diversity.

If an explicit model is unavailable or rejected, refresh discovery once. Follow the saved release preference if it supplies a verified replacement. Otherwise inherit the parent for that run and disclose the unavailable choice once. Preserve the saved preference for later setup. If a task requires different model families, report the missing review coverage rather than count inheritance as diversity. Never change subscriptions, providers, credentials, permissions, privacy restrictions, or the primary chat model to fill a role.

## Follow new releases

Store one of these release preferences in the repository preferences or personal overrides. Preserve any role-specific exceptions.

- `follow-family` selects a verified successor in the user's approved model series and existing access tier. Verify the successor relationship through native metadata or official provider documentation. Confirm that the harness accepts its exact ID and meets the role's tool, context, and reasoning requirements. Resolve IDs and verification state locally, and report a changed selection once. Leave shared series preferences unchanged during routine discovery. If the relationship or access is unclear, keep a working current model and ask about the candidate when it affects the task. A larger version number or a similar name alone does not prove succession.
- `ask` keeps working choices and asks before adopting a discovered successor. This is the default when the user has not chosen a release preference.
- `pinned` keeps exact model IDs until the user changes them. Use a fixed ID when the harness supports one. A native alias may change its underlying model, so disclose that limitation instead of claiming it is pinned.

Check for successors during setup, when the user names a release, when a configured ID stops working, and during the first model discovery in a new chat. Use native release metadata when available. Otherwise check the approved series in official documentation when browsing is available. Do not promise background monitoring. If current release information is unavailable, use the last verified working choice and state the gap when relevant. Do not poll during each spawn.

An exact model requested for the current task overrides release following for that task. Save it as a pin only when the user asks for a persistent exception. A new model series or provider needs a new user preference. Do not broaden an approved series to whichever model appears newest.

## Match effort and speed

Model, reasoning effort, and speed are separate choices. Inherit the native effort and speed unless the user sets them. A saved budget can request medium, high, xhigh, or max effort for small, medium, large, or unlimited budgets. Apply only values the selected model and harness support. Use the highest supported effort at or below the requested level, or keep the native setting and report the mismatch when no mapping exists.

Use any saved role-specific effort and speed before the general budget. Keep verification on the configured `swarm workers` choice. Do not append reasoning or speed suffixes, remove suffixes, or infer a model family from a prefix. When a harness encodes effort or speed in model IDs, choose only IDs its current catalog confirms. Inheritance never grants permission to change the parent chat's settings.

## Use an optional expert

An `expert consultation` choice in repository preferences or personal overrides can supply a costlier second opinion without moving implementation or verification onto that model. This role is disabled when absent or explicitly inherited. Read its saved triggers, effort, and consultation limit before spawning it. Keep it disabled until its triggers and limit are set. Ask about missing limits during setup.

Give the expert one bounded, read-only question. The parent keeps implementation, testing, and follow-up work on their configured roles. A consultation cannot start more agents or a retry loop. Count consultations across the entire user task, including delegated work and resumed context. Honor any purpose-specific reservations within the allowance. Pass the remaining allowance in handoffs. Skip the consultation when its triggers do not apply. Report a missing expert rather than substitute another expensive model. A consultation count limits calls, not currency spend. Do not claim a hard monetary cap without native enforcement.
