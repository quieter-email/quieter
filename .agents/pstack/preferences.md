# Quieter model preferences

These repository defaults apply on every machine. Read them through [the model policy](models.md). Explicit task choices and personal overrides take precedence.

The release preference is `follow-family`. Follow verified successors within the chosen model series and existing access tier. Exact task choices and persistent version pins remain available. Inherit native reasoning effort and speed except for the expert setting below.

| Harness | Default model series | Optional expert |
| --- | --- | --- |
| Codex | OpenAI GPT Sol | OpenAI GPT Astra, within the limits below |
| Cursor | Newest verified Grok coding release | Disabled |
| OpenCode Go | Current DeepSeek coding default included in the Go plan | Disabled |
| Claude Code | `inherit-parent` until configured | Disabled |
| Other harnesses | `inherit-parent` until configured | Disabled |

Each default covers every required role in [setup](setup.md), including difficult implementation, writing, verification workers, and panel entries. Preserve explicit panel sizes. Repeated models provide separate perspectives rather than model diversity.

The Codex session verified `gpt-6.1-sol` and `gpt-6-astra` as native choices on 2026-10-27. These are discovery starting points, not version pins. Prefer their verified successors when available. Confirm model support and access on each machine before using an explicit ID.

Resolve Cursor's exact Grok IDs from its native catalog. For OpenCode Go, verify that Go is connected and use native agents with confirmed provider-qualified DeepSeek IDs. Keep inherited placeholders while access or IDs are unresolved. If several DeepSeek product lines have no clear native default, ask which to follow. Preserve privacy and region restrictions. Do not substitute another provider's free or paid model.

## Codex expert consultations

Use Astra only for a hard design or debugging decision, repeated Sol failures on the same problem, a substantive review, or substantive frontend ideation. Skip routine edits such as variable changes.

Use medium reasoning effort when supported. Give Astra one concise, read-only question. Sol keeps implementation, testing, and follow-up work. The expert cannot start more agents, implementation workers, or retry loops.

Allow at most one consultation per user task when required. Substantive frontend work may use two calls, one reserved for ideation and one for final review. Count calls across workers, phases, retries, and resumed context. Pass the remaining allowance in handoffs. Continue on Sol when the allowance is used.

## Change these preferences

Update this file to change the shared model series, consultation limits, or release preferences. For a role-specific exception, add its existing `<role>: <value>` line under a section for that harness, with any pin, effort, or speed preference beside it. An explicit `inherit-parent` override keeps that role inherited.

Resolve current IDs and machine-specific OpenCode agent names locally. Do not rewrite this file during routine discovery or copy a machine's authentication state into it. Use `setup-pstack` when changing preferences, rather than editing bundled skill instructions.
