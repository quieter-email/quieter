# Pstack

This repository tracks 58 pstack skills in `.agents/skills/`. Codex and Cursor load that shared directory. Claude Code and OpenCode load the same files through `.claude/skills` and `.opencode/skills`. A fresh checkout includes the links and skills.

The source is the [standalone mirror](https://github.com/backnotprop/pstack/tree/37d989cabf310ea2d7631f1d006117ca4cc8a799) of [Lauren Tan's pstack](https://github.com/cursor/plugins/tree/519d36aa98955bf680db01bcde5fdfba686dc901/pstack), version 0.15.34. `skills-lock.json` records the mirror revision and source hashes. The bundled [MIT license](../.agents/skills/pstack-LICENSE.txt) applies.

## Use pstack

| Client | Start a task | Set role models |
| --- | --- | --- |
| T3 Code | Use the active client's loader or mention `poteto-mode` | Run `setup-pstack` |
| Codex | `$poteto-mode fix the mailbox switching bug` | `$setup-pstack` |
| Claude Code | `/poteto-mode fix the mailbox switching bug` | `/setup-pstack` |
| Antigravity | Load `poteto-mode` with the skill loader | Load `setup-pstack` |
| OpenCode, including Go | `Load poteto-mode and fix the mailbox switching bug` | `Load setup-pstack` |
| Cursor | `/poteto-mode fix the mailbox switching bug` | `/setup-pstack` |

OpenCode loads skills through its `skill` tool. Skills do not create slash commands there. Claude Code uses unprefixed commands because these are project skills, rather than a separately installed pstack plugin. Start a new session if a client does not detect the updated files.

The [client adapter](../.agents/pstack/harnesses.md) maps delegation, models, questions, history, and optional Cursor features to each client, including T3 Code cross-provider delegation (`orchestrator_capabilities` and `delegate_task`) and Antigravity. Tool-dependent skills link to it, including when invoked directly. `AGENTS.md` remains the project policy. `CLAUDE.md` imports that policy for Claude Code.

The [repository preferences](../.agents/pstack/preferences.md) keep model choices, T3 Code multi-model routing, rate-limit fallbacks, and consultation limits synchronized through Git. In T3 Code, GPT Sol handles main implementation, debugging, and hard thinking. Claude Opus handles frontend work, prose, and synthesis. Gemini Neon handles rate-limit fallbacks for any model. Grok and DeepSeek Flash handle exploration, verification swarms, and throwaway tasks only, never main thinking. Substantive changes finish with a parallel read-only review pass across Opus, Astra, and Neon, keeping Astra restricted to bounded short calls because its usage is substantial. Outside T3 Code, single-harness defaults map Codex to GPT Sol with bounded GPT Astra consultations, Claude Code to Claude Opus, Antigravity to Gemini Neon, Cursor to Grok, and OpenCode Go to its included DeepSeek coding default. Each machine verifies native IDs and provider access before using explicit models.

Run `setup-pstack` to change which models handle coding, frontend work, hard debugging, investigation, writing, verification, throwaway tasks, review panels, and rate-limit fallbacks. Setup updates repository preferences by default and preserves existing choices. Optional personal settings can override individual roles. Credentials and machine-specific agent configuration stay local. The [setup instructions](../.agents/pstack/setup.md) describe the questions and settings format.

The [model policy](../.agents/pstack/models.md) supports cross-provider routing in multi-model hosts, following verified successors within a chosen model series, asking before upgrades, pinning exact versions, and falling back cleanly when a model hits rate limits. Release following checks native harness support and existing access. It preserves task-specific model choices and persistent exceptions. Discovery runs during setup and the first explicit model selection in a new chat, without a background monitor. Routine discovery leaves shared preferences unchanged. An optional expert role provides a limited second opinion while implementation and verification stay on their regular models.

For OpenCode Go, connect the subscription through `/connect` and select an available model through `/models`. Inspect the installed catalog with `opencode models`. If that version does not expose the Go provider, update OpenCode before connecting it. Pstack does not change providers or configure billing. OpenCode agents inherit the active model unless a confirmed native agent supplies a different one.

This update adds `statechart` for TLA+ state models and `ketchup-video` for video catch-ups. It also includes upstream orchestration, PR-monitoring, and comment-review fixes. Video output requires an available renderer and client media support. The adapter specifies the text fallback.

## Run the bundled tools

Install dependencies through the workspace:

```sh
vp install
vp run pstack:check
vp exec bun .agents/skills/poteto-mode/scripts/watch-pr/watch-pr --help
vp exec bun .agents/skills/poteto-mode/scripts/orch/orch.ts --help
```

The PR monitor and orchestrator need Bun. Their dependencies come from the Vite+ workspace. The upstream self-install bootstrap and nested Bun lockfile stay excluded. Statechart's test and renderer dependencies also come from the workspace, so tests do not run a hidden package install. Run a model with `vp exec .agents/skills/statechart/scripts/statechart /absolute/path/Model.tla`.

Statechart's first model check needs Java and TLC. Its supported setup uses mise, or existing `JAVA` and `TLA2TOOLS` paths. See the [statechart skill](../.agents/skills/statechart/SKILL.md). Model files and generated reports belong in a scratch directory unless the task calls for tracked artifacts.

The worktree audit handles GNU and BSD timestamps and paths containing spaces or regular-expression characters. It cannot infer Codex or OpenCode activity from legacy project transcript folders. It marks otherwise removable worktrees for chat-history review when those clients have session storage. Check history through the native client before cleanup.

## Update the installation

Review the mirror changes and choose a full commit ID. Substitute it for `REVIEWED_COMMIT`:

```sh
vp dlx -- skills@1.7.4 add https://github.com/backnotprop/pstack/tree/REVIEWED_COMMIT/skills --agent codex --skill '*' --yes
vp exec node scripts/adapt-pstack.ts
vp install
vp run pstack:check
```

The installer refreshes the canonical skills and source lock entries. The adaptation script restores the client routing, native skill links, public help links, installed plan paths, portable worktree audit, and Vite+ dependency handling. It also reapplies the reviewed statechart fixes and model-routing changes from `.agents/pstack/*.patch`. Its inputs are the installed files and the pinned revision in `skills-lock.json`. It is safe to rerun. If an upstream change prevents a patch from applying, reconcile the source before updating.

Keep the adapter and native setup instructions under `.agents/pstack/`, outside the directories the installer replaces. Review any new upstream dependencies and tool assumptions before committing. Compare the result with the source revision so a changed upstream entry point does not silently bypass an adaptation.

Run the bundled checks after an update:

```sh
vp run @cursor-skill/poteto-mode-tools#test
vp run @cursor-skill/poteto-mode-tools#typecheck
vp run @cursor-skill/statechart#test
```

Statechart runs replay, parser, CLI, and renderer checks. Its conditionally skipped live TLC suites were removed during test cleanup. Application formatting, linting, and Vitest discovery exclude `.agents/` and the native skill links because these tools use their own conventions and Bun or Node test runners.
