# Set up pstack models

Follow these steps for Codex, Cursor, Claude Code, OpenCode including Go, and other harnesses. Read the [client adapter](harnesses.md) and [model policy](models.md). Do not change authentication, subscriptions, permissions, or the user's primary chat model.

## Discover the requested harnesses

Identify the running harness from the exposed tools. Ask which other harnesses the user wants configured when the request covers more than this session. Read [repository preferences](preferences.md) first, then any personal overrides. Update repository preferences by default so Git keeps machines synchronized. Write personal overrides only when the user asks for them.

Read existing choices from the adapter's settings paths. Inspect accepted models, supported effort and speed controls, and provider access for the requested harnesses. In Codex, use this session's exposed model choices. In Cursor, use its native model catalog. In Claude Code, use only confirmed native aliases or IDs. In OpenCode, inspect `opencode models`, connected providers, and agent configuration. Never print credentials.

If another harness is unavailable, ask for its native model names when needed. Record the preference as pending verification without treating it as an available model or replacing a working choice. Do not translate another harness's display name into a guessed ID.

## Ask about tasks

Ask only for preferences the user has not already supplied. Prefer the native question tool. Group roles into understandable task choices, then expand the answers using this table. Let the user override individual roles.

| Task choice | Role labels |
| --- | --- |
| Routine coding and fixes | `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb` |
| Hard debugging and architecture | `hardest tasks` |
| Code exploration and investigation | `how explorer`, `why investigators`, `reflect tooling` |
| Writing, explanation, and judgment | `judgment and prose`, `how explainer`, `why synthesizer`, `reflect judgment, divergent, synthesizer` |
| Verification workers | `swarm workers` |
| Design and review panels | `arena runners`, `architect runners`, `interrogate reviewers`, `arena cross-judge pool` |

Offer an optional `expert consultation` role when the user wants a stronger model for occasional second opinions. Ask which situations merit it and how many consultations a task may use. Keep it separate from implementation, verification, and panel models. This role stays disabled unless explicitly configured.

Ask which models should handle those tasks in each requested harness. A choice of one model for everything fills every required role, including panel entries. Keep the optional expert disabled without an explicit consultation request. When the user says a model should handle most work, offer it as the default and ask only about exceptions. Preserve panel counts. Explain when the available models cannot provide different model families.

Ask about effort and speed only when not supplied. Offer native inheritance, or small, medium, large, and unlimited reasoning budgets where supported. Keep inheritance when the user has no preference.

Ask how to handle new releases. Offer `follow-family`, `ask`, and `pinned` with the meanings in the model policy. For `follow-family`, record the approved product series and access tier for each explicit model choice. Allow exact-version pins and role-specific exceptions. Do not replace the user's preferences with new bundled defaults on reruns.

## Write the choices

Show the resolved task-to-model table for each requested harness, with effort, speed, panel counts, and release preferences. Ask only about unresolved choices. The user's explicit selections authorize those settings without another confirmation.

Validate explicit IDs against the harness and provider access. Use `inherit-parent` for undecided roles. Do not activate unverified cross-harness choices. Preserve them in a clearly marked pending section so setup in that harness can validate them later.

Update only the requested harnesses in the repository preferences, unless the user requested personal overrides. Keep shared model series and consultation limits in the repository. Preserve valid choices for other harnesses. Resolve native IDs and machine-specific OpenCode agents locally rather than committing their verification state.

For personal overrides or repository role exceptions, keep the existing `<role>: <value>` format. Panel values are comma-separated lists. Store effort separately from IDs unless the native catalog encodes it in IDs. For OpenCode, use `agent:<name>` only in machine-local settings after configuring and verifying that native subagent.

Record these metadata fields as comments above the role lines:

```text
# budget: inherit
# speed: inherit
# releases: follow-family
# verified: YYYY-MM-DD
# approved series and access: <native model or agent> = <user-approved product series and existing access tier>
```

Use the user's selected release preference in place of the example. For a specific effort choice, retain the native effort or the existing `# budget: <label> (<effort>)` form. Record role-specific pins, effort, speed, and approved series beside the affected role. Do not claim a verification date for pending choices.

For repository preferences, record the default model series and any role exceptions per harness. A default covers every required role in the table above. For personal overrides, write only the requested role exceptions so repository defaults continue to apply elsewhere. Add `expert consultation` only when requested, with its triggers and limits beside it. Without any applicable choices, scalar roles use `inherit-parent`, panels use `inherit-parent, inherit-parent`, and the cross-judge pool uses `inherit-parent`. Repeated entries count toward panel size. The cross-judge pool supplies one judge rather than a judge per entry.

For personal Cursor rules, retain `alwaysApply: true` and the rule description in YAML frontmatter. Repository preferences and other harnesses use plain Markdown. Preserve unrelated notes and pending choices. Report the written paths, resolved models, inherited settings, and any access or model-diversity gaps.

## Configure OpenCode agents when needed

OpenCode's `task` selects an agent, not an arbitrary model. To use a different model, configure a native subagent in its supported `agents/` directory. Set `mode: subagent`, a concise description, and the exact confirmed `model: provider/model-id`. Keep permission settings intact. Reuse an existing matching agent or include any replacement in the resolved table. An inherited role needs no custom agent and uses `general`.

When following a new release, update the associated agent's model as well as its resolved preference. Keep another role's pin or effort override on a separate agent when their settings would conflict.

Offer verification-skill generation only when the user wants broader setup and the project lacks suitable checks. Skip those offers for a model-preference update.
