# quieter model preferences

These repository defaults apply on every machine. Read them through [the model policy](models.md) and [the client adapter](harnesses.md). Explicit task choices and personal overrides take precedence.

The release preference is `follow-family`. Follow verified successors within each approved model series and existing access tier. Exact task choices and persistent version pins remain available. Inherit native reasoning effort and speed except where a role specifies guidance below.

## Model tiers

- **Main frontier models.** Anthropic Claude Opus (`claudeAgent`), OpenAI GPT Sol (`codex`), OpenAI GPT Astra (`codex`, bounded short work only because usage is substantial), and Google Gemini Neon (`antigravity`).
- **Exploration and throwaway models.** xAI Grok (`cursor` or verified `opencode-go`) and DeepSeek Flash (verified `opencode` or `opencode-go`). Use these only for codebase exploration, parallel verification checks, and non-critical or throwaway tasks. Never use them for main thinking, core architecture, complex implementation, subtle debugging, security or isolation logic, or final review synthesis.

## T3 Code multi-model routing

Use this routing whenever the host supports cross-provider delegation (T3 Code `orchestrator_capabilities` and `delegate_task`). Call `orchestrator_capabilities` once per thread before the first `delegate_task` to confirm active providers, exact IDs, and `target.options`.

| Task category | Role labels | Provider and model series | Guidance |
| --- | --- | --- | --- |
| Main implementation and fixes | `feature, refactoring`, `bug-fix`, `perf-issue`, `hillclimb` | `codex`: OpenAI GPT Sol | Primary workhorse for backend and full-stack implementation, root-cause bug fixing, performance fixes, and iterative work. Inherit default effort for small fixes. Use `high` or `xhigh` for complex changes. |
| Hard thinking and architecture | `hardest tasks` | `codex`: OpenAI GPT Sol | Core systems thinking, concurrency, state machines, migrations, and security or isolation logic. Use `xhigh` or `max` effort. Escalate bounded second opinions to Astra via `expert consultation` when stuck. |
| Frontend and UI work | `frontend` | `claudeAgent`: Anthropic Claude Opus | React components, `packages/ui`, design-system alignment, layout, styling, animations, accessibility, visual parity, and UI prototypes. Use `medium` or `high` for routine UI edits. Use `high` or `xhigh` for complex UI architecture. |
| Writing, explanation, and judgment | `judgment and prose`, `how explainer`, `why synthesizer`, `reflect judgment, divergent, synthesizer` | `antigravity`: Google Gemini Neon (fallback: active chat model / `inherit-parent`) | Architectural explanations, synthesis of explorer findings, documentation, PR prose, and nuanced judgment calls. If Gemini Neon is unavailable or hits limits, keep the task on the active chat's model (`inherit-parent`). |
| Post-work and adversarial reviews | `interrogate reviewers` | `claudeAgent`: Anthropic Claude Opus, `codex`: OpenAI GPT Astra, `antigravity`: Google Gemini Neon | Three independent frontier families. Run in parallel as fresh, bounded, read-only reviews after substantive changes. Keep Astra single-pass at `medium` or `high` effort. Address findings on Sol or Opus. Skip Astra on trivial routine edits. |
| Design and architecture bakeoffs | `architect runners`, `arena runners` | `codex`: OpenAI GPT Sol, `claudeAgent`: Anthropic Claude Opus | Add `antigravity`: Google Gemini Neon as a third runner when exploring three distinct directions. For frontend-only bakeoffs, pair Claude Opus with Gemini Neon or GPT Sol. |
| Arena cross-judge | `arena cross-judge pool` | `claudeAgent`: Anthropic Claude Opus, `antigravity`: Google Gemini Neon, `codex`: OpenAI GPT Astra | Pick one read-only judge from a different family than the parent. Use Astra only for high-stakes architectural bakeoffs as a single bounded call. |
| Codebase exploration and investigation | `how explorer`, `why investigators`, `reflect tooling` | `cursor`: xAI Grok (primary), `opencode`: DeepSeek Flash (secondary when verified) | Fast read-only repo traversal, git and PR history, MCP evidence collection, and tooling checks feeding a frontier synthesizer. Never use for main thinking. |
| Verification swarms | `swarm workers` | `cursor`: xAI Grok (or verified `opencode`: DeepSeek Flash for low-stakes checks) | Parallel verification slices, mechanical checks, and concrete pass or fail lanes. Do not use for main implementation or architectural judgment. |
| Throwaway and non-critical tasks | `throwaway` | `opencode`: DeepSeek Flash (when verified), `cursor`: xAI Grok (when OpenCode is unverified) | Disposable scripts, one-off data transforms, file inventories, quick lookups, and low-stakes chores. Never use for main thinking. |
| Bounded expert second opinion | `expert consultation` | `codex`: OpenAI GPT Astra | One concise, bounded, read-only consultation for hard design or debugging decisions or repeated Sol failures. Use `medium` or `high` effort. Never long-running tasks, implementation, or retry loops. |
| Rate-limit fallback | `limit fallback` | `antigravity`: Google Gemini Neon | Automatic substitute when any configured model hits rate limits, usage caps, or temporary unavailability. Never downgrade main thinking onto Grok or DeepSeek Flash. |

### Post-work multi-model reviews

After substantive changes in T3 Code (new features, non-trivial bug fixes, refactors, frontend work, security or isolation changes, or architectural edits), run a parallel, read-only review pass with **Claude Opus**, **GPT Astra**, and **Gemini Neon** via `delegate_task` using the `interrogate` review template.

Keep every reviewer read-only and bounded to one pass. Give a fresh reviewer seat to every model on the panel (including a cold-context reviewer when the parent model authored the diff). Address accepted findings on Sol (or Opus for frontend work), then verify cleanly rather than opening follow-up loops on Astra. Skip heavy-usage Astra reviews on routine edits such as copy, spacing, or token adjustments.

### Rate-limit fallback

When any configured model (Sol, Opus, Astra, Grok, or DeepSeek Flash) hits rate limits, quota caps, or temporary provider unavailability, route the affected run to **Gemini Neon** (`antigravity`) and disclose the fallback once. Use `thought_level: "high"` or `"xhigh"` when replacing frontier work and `"medium"` for routine tasks. When Gemini Neon itself is unavailable or hits limits on a Neon-routed role (such as writing, explanation, and judgment), fall back to the active chat's model (`inherit-parent`) and disclose the fallback once. Preserve the saved preference for future runs.

During a three-model review (`Opus`, `Astra`, `Neon`), Gemini Neon is already on the panel. If Opus or Astra hits limits, do not spawn a second Neon reviewer to fake diversity. Substitute **GPT Sol** (`codex`) when Sol did not author the diff, or run the remaining reviewers and note the missing model family.

### Bounded Astra usage

Usage with Astra is substantial. Never use Astra for long-running implementation, iterative debugging, hillclimbing, exploration sweeps, or retry loops.

In T3 Code, reserve Astra for bounded single-pass post-work reviews, high-stakes `arena` cross-judging, and at most one separate read-only `expert consultation` per task when blocked on a hard design or debugging decision.

In standalone Codex (without T3 Code cross-provider delegation), use Astra only for a hard design or debugging decision, repeated Sol failures on the same problem, a substantive review, or substantive frontend ideation. Skip routine edits such as variable changes. Use `medium` reasoning effort when supported, give Astra one concise read-only question, and keep Sol on implementation, testing, and follow-up work. Allow at most one consultation per user task, or two for substantive frontend work (one for ideation and one for final review). Count calls across workers, phases, retries, and resumed context, pass the remaining allowance in handoffs, and continue on Sol when the allowance is used.

## Single-harness defaults

When running outside T3 Code (without cross-provider delegation), use the active harness's default series below. Each default covers every required role in [setup](setup.md), including difficult implementation, writing, verification workers, and panel entries. Preserve explicit panel sizes. Repeated models provide separate perspectives rather than model diversity.

| Harness | Default model series | Optional expert |
| --- | --- | --- |
| Codex | OpenAI GPT Sol | OpenAI GPT Astra, within the limits above |
| Claude Code | Anthropic Claude Opus | Disabled |
| Antigravity | Google Gemini Neon | Disabled |
| Cursor | Newest verified Grok coding release | Disabled |
| OpenCode Go | Current DeepSeek coding default included in the Go plan (DeepSeek Flash for lightweight and exploration work) | Disabled |
| Other harnesses | `inherit-parent` until configured | Disabled |

## Discovery starting points

The following IDs were verified on 2026-11-21 in T3 Code (`orchestrator_capabilities`) and `opencode models`. These are discovery starting points, not version pins. Prefer verified successors within each approved series under `follow-family`, and confirm provider support and access on each machine before passing an explicit ID.

- `codex`: `gpt-6.2-sol`, `gpt-6.2-astra` (`reasoningEffort`: `low` through `ultra`, `serviceTier`: `default` or `priority`).
- `claudeAgent`: `claude-opus-5-5` (`effort`: `low` through `ultrathink`, `fastMode`, `ultracode`).
- `antigravity`: `gemini-4-neon` (`thought_level`: `low` through `xhigh`).
- `cursor`: `grok-4.7` (`reasoning_effort`: `low` through `xhigh`, `fastMode`, `contextWindow`: `256k` or `500k`). The standalone `grok` provider instance was disabled.
- `opencode`: `canRunChildTask: true` with an empty capabilities short list. `opencode models` listed `opencode-go/deepseek-v4.1-flash`, `opencode/deepseek-v4.1-flash-free`, `opencode-go/deepseek-v4-pro`, and `opencode-go/grok-4.7`. Confirm connected OpenCode provider authorization before passing an explicit OpenCode ID, preserve privacy and region restrictions, and do not substitute an unapproved paid provider.

## Change these preferences

Update this file to change the shared model series, cross-provider routing, fallback choices, consultation limits, or release preferences. For a role-specific exception, add its existing `<role>: <value>` line under a section for that harness, with any pin, effort, or speed preference beside it. An explicit `inherit-parent` override keeps that role inherited.

Resolve current IDs and machine-specific OpenCode agent names locally. Do not rewrite this file during routine discovery or copy a machine's authentication state into it. Use `setup-pstack` when changing preferences, rather than editing bundled skill instructions.
