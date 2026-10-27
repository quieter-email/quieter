# Pstack

This repository tracks 58 pstack skills in `.agents/skills/`. Codex and Cursor load that shared directory. Claude Code and OpenCode load the same files through `.claude/skills` and `.opencode/skills`. A fresh checkout includes the links and skills.

The source is the [standalone mirror](https://github.com/backnotprop/pstack/tree/37d989cabf310ea2d7631f1d006117ca4cc8a799) of [Lauren Tan's pstack](https://github.com/cursor/plugins/tree/519d36aa98955bf680db01bcde5fdfba686dc901/pstack), version 0.15.34. `skills-lock.json` records the mirror revision and source hashes. The bundled [MIT license](../.agents/skills/pstack-LICENSE.txt) applies.

## Use pstack

| Client | Start a task | Set role models |
| --- | --- | --- |
| Codex | `$poteto-mode fix the mailbox switching bug` | `$setup-pstack` |
| Claude Code | `/poteto-mode fix the mailbox switching bug` | `/setup-pstack` |
| OpenCode, including Go | `Load poteto-mode and fix the mailbox switching bug` | `Load setup-pstack` |
| Cursor | `/poteto-mode fix the mailbox switching bug` | `/setup-pstack` |

OpenCode loads skills through its `skill` tool. Skills do not create slash commands there. Claude Code uses unprefixed commands because these are project skills, rather than a separately installed pstack plugin. Start a new session if a client does not detect the updated files.

The [client adapter](../.agents/pstack/harnesses.md) maps delegation, models, questions, history, and optional Cursor features to each client. Tool-dependent skills link to it, including when invoked directly. `AGENTS.md` remains the project policy. `CLAUDE.md` imports that policy for Claude Code.

Outside Cursor, unconfigured roles inherit the parent model. Run `setup-pstack` to choose native models and supported reasoning settings. Settings remain per user and per client. No model preferences or credentials are installed by this repository. The [native setup instructions](../.agents/pstack/setup.md) list the settings paths and configuration behavior.

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

The installer refreshes the canonical skills and source lock entries. The adaptation script restores the client routing, native skill links, public help links, installed plan paths, portable worktree audit, and Vite+ dependency handling. It also reapplies the reviewed statechart fixes in `.agents/pstack/statechart-fixes.patch`. Its inputs are the installed files and the pinned revision in `skills-lock.json`. It is safe to rerun. If an upstream change prevents the patch from applying, reconcile the source before updating.

Keep the adapter and native setup instructions under `.agents/pstack/`, outside the directories the installer replaces. Review any new upstream dependencies and tool assumptions before committing. Compare the result with the source revision so a changed upstream entry point does not silently bypass an adaptation.

Run the bundled checks after an update:

```sh
vp run @cursor-skill/poteto-mode-tools#test
vp run @cursor-skill/poteto-mode-tools#typecheck
vp run @cursor-skill/statechart#test
```

Statechart skips live TLC cases when `TLA2TOOLS` is absent. Its replay, parser, CLI, and renderer cases still run. Application formatting, linting, and Vitest discovery exclude `.agents/` and the native skill links because these tools use their own conventions and Bun or Node test runners.
