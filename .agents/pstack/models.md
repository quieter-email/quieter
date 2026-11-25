# Choose pstack models

Use this policy for every harness and role, including skills invoked directly. The [repository preferences](preferences.md) hold shared model choices, cross-provider routing, fallbacks, and consultation limits. The [client adapter](harnesses.md) owns native tools and personal override paths. The [setup steps](setup.md) own preference questions and role labels. Keep model choices out of bundled skill instructions.

## Resolve a role

1. Read the repository preferences and this harness's personal overrides. Honor an explicit task-specific choice first, then a personal role override, then a repository role override, then the repository's default for this harness. When the active host supports cross-provider delegation (such as T3 Code via `delegate_task`), apply its multi-provider routing table across the user's approved providers. An explicit `inherit-parent` is an override. Apply personal effort, speed, and release overrides where present, otherwise use the repository preferences. Resolve pending choices when native discovery can verify them. Until then, inherit for unresolved roles. Use a legacy personal file only when the adapter allows it and its choices work in this harness.
2. Check the delegation tool's accepted providers, models, and effort controls before the first explicit model selection in a chat (`orchestrator_capabilities` in T3 Code). A provider catalog proves that an ID exists, not that the user has access. Preserve provider-qualified IDs and native agent names.
3. Apply the saved release preference below. Keep the exact resolved ID separate from its approved model series. A model series is a product line within a provider, not the provider's entire catalog.
4. Pass only supported native arguments. `auto` and `inherit-parent` mean omit the model override. OpenCode's `agent:<name>` means select that configured native agent, not pass a model argument.

Route specialized tasks to their dedicated roles when configured:

- Route frontend and UI implementation (components, styling, layout, design-system work, visual polish, accessibility, and UI prototypes) to `frontend` instead of `feature, refactoring`.
- Route disposable scripts, non-critical chores, and quick low-stakes checks to `throwaway` when configured.
- Keep exploration and throwaway models (`how explorer`, `why investigators`, `reflect tooling`, `swarm workers`, `throwaway`) strictly off main thinking, core architecture, complex implementation, subtle debugging, security or isolation logic, and final review synthesis.

When neither repository preferences nor personal overrides configure a role, it inherits the parent in every harness, including Cursor. An unconfigured panel uses two `inherit-parent` entries. The cross-judge pool defaults to one `inherit-parent` entry. Preserve explicit panel sizes, including repeated models. Several agents using one model provide separate perspectives, not model diversity.

## Handle rate limits and unavailability

If an explicit model is rejected or unavailable, refresh discovery once and follow the saved release preference if it supplies a verified successor.

When a configured model hits a rate limit, quota cap, or temporary provider outage and no same-series successor is available:

1. Check whether `limit fallback` is configured in repository preferences or personal overrides and is available in the active host.
2. Route the affected run to the `limit fallback` model, preserve the saved preference for future runs, and disclose the fallback once.
3. Never downgrade main thinking or frontend implementation onto an exploration or throwaway model when a frontier fallback is available.
4. On a multi-model review or design panel, do not duplicate a model family already on the panel to cover a rate-limited seat. Substitute an unused approved frontier family when available, or run the reduced panel and report the missing model family.
5. When no configured fallback is available, inherit the parent for that run and disclose the unavailable choice once. If a task requires different model families, report the missing review coverage rather than count inheritance as diversity.

Never change subscriptions, credentials, permissions, privacy restrictions, or the primary chat model, and never use an unapproved provider to fill a role.

## Follow new releases

Store one of these release preferences in the repository preferences or personal overrides. Preserve any role-specific exceptions.

- `follow-family` selects a verified successor in the user's approved model series and existing access tier. Verify the successor relationship through native metadata or official provider documentation. Confirm that the harness accepts its exact ID and meets the role's tool, context, and reasoning requirements. Resolve IDs and verification state locally, and report a changed selection once. Leave shared series preferences unchanged during routine discovery. If the relationship or access is unclear, keep a working current model and ask about the candidate when it affects the task. A larger version number or a similar name alone does not prove succession.
- `ask` keeps working choices and asks before adopting a discovered successor. This is the default when the user has not chosen a release preference.
- `pinned` keeps exact model IDs until the user changes them. Use a fixed ID when the harness supports one. A native alias may change its underlying model, so disclose that limitation instead of claiming it is pinned.

Check for successors during setup, when the user names a release, when a configured ID stops working, and during the first model discovery in a new chat. Use native release metadata when available. Otherwise check the approved series in official documentation when browsing is available. Do not promise background monitoring. If current release information is unavailable, use the last verified working choice and state the gap when relevant. Do not poll during each spawn.

An exact model requested for the current task overrides release following for that task. Save it as a pin only when the user asks for a persistent exception. A new model series or provider needs a new user preference. Do not broaden an approved series to whichever model appears newest.

## Match effort and speed

Model, reasoning effort, and speed are separate choices. Inherit the native effort and speed unless the user sets them. A saved budget can request medium, high, xhigh, or max effort for small, medium, large, or unlimited budgets. Apply only values the selected model and harness support. In multi-provider hosts such as T3 Code, pass effort through each provider's native option key (`reasoningEffort`, `effort`, `thought_level`, or `reasoning_effort`) confirmed by discovery. Use the highest supported effort at or below the requested level, or keep the native setting and report the mismatch when no mapping exists.

Use any saved role-specific effort and speed before the general budget. Keep verification on the configured `swarm workers` choice. Do not append reasoning or speed suffixes, remove suffixes, or infer a model family from a prefix. When a harness encodes effort or speed in model IDs, choose only IDs its current catalog confirms. Inheritance never grants permission to change the parent chat's settings.

## Use an optional expert

An `expert consultation` choice in repository preferences or personal overrides can supply a costlier second opinion without moving implementation or verification onto that model. This role is disabled when absent or explicitly inherited. Read its saved triggers, effort, and consultation limit before spawning it. Keep it disabled until its triggers and limit are set. Ask about missing limits during setup.

Restrict heavy-usage models (such as Astra) to bounded, short, read-only consultations and single-pass reviews. Never assign them to long-running implementation, iterative debugging, hillclimbing, exploration, or retry loops.

Give the expert one bounded, read-only question. The parent keeps implementation, testing, and follow-up work on their configured roles. A consultation cannot start more agents or a retry loop. Count consultations across the entire user task, including delegated work and resumed context. Honor any purpose-specific reservations within the allowance. Pass the remaining allowance in handoffs. Skip the consultation when its triggers do not apply. Report a missing expert rather than substitute another expensive model. A consultation count limits calls, not currency spend. Do not claim a hard monetary cap without native enforcement.

## Run post-work multi-model reviews

When repository preferences configure a multi-model `interrogate reviewers` panel and the active host supports cross-provider delegation, run a parallel, read-only review pass after substantive implementation changes (features, non-trivial bug fixes, refactors, frontend changes, security or isolation logic, or architectural edits).

1. Launch each reviewer as a fresh, read-only child task over the diff and stated intent.
2. Keep heavy-usage reviewers bounded to one single-pass review at their configured effort. Address findings on the configured implementation or frontend role rather than running follow-up loops on a heavy-usage reviewer.
3. Scale review depth to the change. Skip heavy-usage reviewers on trivial routine edits such as copy, token, or spacing tweaks where repository policy does not require full adversarial review.
