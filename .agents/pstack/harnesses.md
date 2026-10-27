# Pstack in this client

Read this file before applying pstack's tool, model, transcript, or permission instructions. These mappings override Cursor-specific instructions in the bundled skills and playbooks. Follow the current tool schema and repository policy first. A skill does not grant permission to send messages, deploy, merge, or change external data.

## Discover and invoke skills

The canonical files are in `.agents/skills/`. `.claude/skills` and `.opencode/skills` link to that directory. Resolve supporting files from the canonical skill directory so relative paths stay valid. Do not install a second copy of pstack as a plugin in this repository.

| Client | Invocation | Model settings |
| --- | --- | --- |
| Codex | `$poteto-mode` or the skill name | `~/.codex/pstack-models.md` |
| Claude Code | `/poteto-mode` | `~/.claude/rules/pstack-models.md` |
| OpenCode, including Go | Ask to load `poteto-mode` with the `skill` tool | `~/.config/opencode/pstack-models.md` |
| Cursor | `/poteto-mode` | `~/.cursor/rules/pstack-models.mdc` |
| Pi and other clients | The client's skill loader | `~/.agents/pstack-models.md` |

OpenCode skills are not slash commands. `/poteto-mode` works there only if a separate custom command exists. This installation uses its native skill loader.

Read this harness's settings when selecting a role. If the Codex, Claude Code, or OpenCode file is absent, read the legacy `~/.agents/pstack-models.md`, but use only choices available in this client. Honor native config-home overrides when resolving these default paths. Run `setup-pstack` through [the setup steps](setup.md) to change settings.

## Delegate with native tools

| Client | Spawn | Collect results | Model selection |
| --- | --- | --- | --- |
| Codex | `spawn_agent` | The exposed agent wait and messaging tools | Omit `model` to inherit. Pass an override only when supported and allowed by the session. |
| Claude Code | `Agent` with `subagent_type: general-purpose` | The returned background task handle or native completion | Use a confirmed native alias or ID accepted by `Agent`. Omit `model` to inherit. |
| OpenCode | `task` with `subagent_type: general` | The task result | Select a configured agent through `subagent_type`. Do not add a `model` argument the task schema does not expose. |
| Cursor | `Task` with the registered agent type | The task handle | Use the configured Cursor slug. |

Replace `poteto-agent` or `comment-sicko` with a general agent when that type is unavailable. Give the worker the absolute `poteto-mode/SKILL.md` path and the required role prompt. A read-only role must be told not to edit when the tool has no read-only switch. Give concurrent writers separate worktrees or non-overlapping files.

Drop unsupported `readonly`, `environment`, `cloud_base_branch`, and `run_in_background` arguments. A Cursor cloud agent maps to an isolated local worktree only when the task needs isolation. Do not invent a remote execution service. If delegation is unavailable or disallowed, perform the roles sequentially and report the missing independent review.

Codex forks can constrain model overrides. Use only the combinations of context inheritance, model, and reasoning effort supported by the exposed schema. Claude Code exposes effort on supported agents. OpenCode puts supported reasoning options in agent or model configuration. Set effort separately when supported. Do not append Cursor's `-xhigh`, `-max`, or `-fast` suffixes to native model IDs.

## Choose available models

Follow [the model policy](models.md) before selecting any role's model, effort, or speed. It applies in every harness and overrides model defaults and fallback rules in upstream prose. Unconfigured roles inherit the parent. Setup asks which models should handle which tasks in each harness and records how to adopt new releases. A listed model is not evidence of provider access.

OpenCode Go is a provider subscription used from OpenCode. It does not change skill discovery or the task tool. Run `opencode models` to inspect the installed client's catalog, then check connected providers through `/connect` and `/models`. A catalog entry alone does not prove authorization. Keep provider-qualified IDs exactly as returned. Do not replace a Go model with a paid Zen, Anthropic, or OpenAI model.

To use different OpenCode models for different roles, configure native agents with those confirmed model IDs and select their names through `subagent_type`. A role may name that agent as `agent:<name>` in the pstack settings file. With no such agent, use `general` and inherit. Native agent and permission settings remain in force.

## Read the right session

Prefer current-chat tools when they expose the needed history. Never scan another project's message bodies to find this project's sessions. Inspect session metadata first, match the active workspace or its explicitly in-scope worktree, then read selected messages. Do not infer the running client from the presence of another client's home directory.

| Client | Scoped history |
| --- | --- |
| Codex | Prefer the app's chat tools. For CLI files, enumerate `~/.codex/sessions/` metadata and keep rollouts whose first record has `payload.cwd` equal to the workspace before reading their contents. Honor a configured Codex home. |
| Claude Code | `~/.claude/projects/<slug>/*.jsonl`. The slug replaces each non-alphanumeric workspace-path character with `-`. Honor a configured Claude config directory. |
| OpenCode | Prefer `opencode session list` and `opencode export <session-id>`. Match the session directory to the active workspace. Storage varies by version and can be SQLite or legacy JSON. Do not assume that `storage/message/` is a JSONL transcript directory. Honor XDG paths. |
| Cursor | The active workspace's `agent-transcripts/` directory. |
| Pi | The active workspace under `~/.pi/agent/sessions/`. |

The worktree audit cannot establish Codex or OpenCode activity from its legacy project transcript scan. When those clients have session storage, it marks otherwise removable worktrees for chat-history review. Check scoped history with the client before any cleanup.

## Replace optional Cursor features

Use the native question tool only when an answer is needed. If none is exposed, ask in chat. Use the native plan tool, or a short local checklist when unavailable. Do not create a Codex goal or recurring automation merely to represent a todo list.

`deslop` means inspect the diff and remove unnecessary prose or code. `create-skill` means the available skill-authoring skill. `control-ui` and `control-cli` mean the available browser or terminal automation. Bugbot and other named reviewers are optional. Inspect actual PR checks and review threads instead of claiming a missing reviewer ran.

Use native timers or bounded waits during an active task. A recurring automation requires the user's request and its own supported tool. Drop unavailable Cursor commands and report any resulting gap. For `ketchup-video`, use an installed renderer and the client's media attachment support. If either is unavailable, return the text update and say the video could not be rendered.

Run project installs and scripts through Vite+. `vp run pstack:check` checks this installation. `vp install` supplies the bundled tool dependencies. Do not restore upstream's Bun self-install bootstrap. Statechart also needs Java and TLC through its supported mise setup or explicit local tool paths. Keep specifications and generated reports outside the repository unless the task requests tracked artifacts.

The discovery and model mappings follow the official [Codex skills guide](https://learn.chatgpt.com/docs/build-skills), [Claude Code skills guide](https://code.claude.com/docs/en/skills), [OpenCode skills guide](https://opencode.ai/docs/skills/), [OpenCode agent guide](https://opencode.ai/docs/agents/), and [OpenCode Go guide](https://opencode.ai/docs/go/). The active tool schema takes precedence when a client version differs.
