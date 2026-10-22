# Pstack

Pstack's 56 skills are installed for this repository in `.agents/skills/`, which both Codex and Cursor discover. They travel with the checkout.

The source is the [standalone mirror](https://github.com/backnotprop/pstack) of [Lauren Tan's pstack](https://github.com/cursor/plugins/tree/main/pstack). The mirror adapts Cursor tool names, model configuration, and supporting references for Codex and other agents. `skills-lock.json` records the upstream source commit and hashes. The bundled [MIT license](../.agents/skills/pstack-LICENSE.txt) applies to these skills.

## Use it

Start a new chat after installation. In Codex, use `$poteto-mode` or ask for the skill by name. In Cursor, use `/poteto-mode`.

```text
$poteto-mode fix the mailbox switching bug, reproduce it first
$how explain how Gmail sync works here
$architect plan this change before implementing it
$interrogate review the current diff
$teach explain this subsystem and why it works this way
$poteto-help which skill fits this task?
```

Use `/` instead of `$` for these examples in Cursor. Pstack routes a task to its more specific workflows, so `poteto-mode` is the usual starting point for substantial work.

Run `$setup-pstack` in Codex or `/setup-pstack` in Cursor to choose models and a reasoning budget. This configuration is per user and per tool, even though the skills are per repository. Codex uses `~/.agents/pstack-models.md`; Cursor uses `~/.cursor/rules/pstack-models.mdc`. No model preferences are installed by this repository.

Project policy in `AGENTS.md` still applies, including Vite+, selective delegation, and the limits on production changes and test creation. Pstack's references to optional Cursor tools use the mirror's harness mappings in Codex.

## Maintain the installation

List installed skills and their agent visibility:

```sh
vp dlx -- skills@1.7.4 list --agent codex cursor
```

The skill files are tracked, so a fresh checkout already includes them. Run `vp install` to install dependencies for the bundled tools along with the application's dependencies. The optional `watch-pr` and `orch` CLIs require [Bun](https://bun.sh/docs/installation) as their runtime and can be inspected without making provider changes:

```sh
vp exec bun .agents/skills/poteto-mode/scripts/watch-pr/watch-pr --help
vp exec bun .agents/skills/poteto-mode/scripts/orch/orch.ts --help
```

This checkout adapts the upstream files for the Vite+ workspace, GNU/BSD transcript timestamps, installed plan paths, and pinned public help guides. An upstream reinstall overwrites those adaptations. To update pstack, install a reviewed mirror commit, reapply the adaptations, then inspect and commit the skill files and lockfile:

```sh
vp dlx -- skills@1.7.4 add https://github.com/backnotprop/pstack/tree/REVIEWED_COMMIT/skills --agent codex cursor --skill '*' --yes
```

The existing standalone `unslop` was replaced in place by the bundled version. The React, design, authentication, and provider skills remain because pstack does not replace their specific guidance.

The lockfile also drops entries for skills that had already been removed from the checkout, so restoring it does not bring those retired skills back. Pstack's own Bun tests are excluded from the application's Vitest discovery.
