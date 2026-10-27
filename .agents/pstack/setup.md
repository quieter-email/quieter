# Set up native pstack models

For Codex, Claude Code, and OpenCode, follow these steps instead of the Cursor slug transformations in `setup-pstack`. Keep the role labels from that skill. Do not change authentication, subscriptions, project permissions, or a user's primary model as part of model setup.

1. Identify the running client from the session's tools. Read its settings path from [the adapter](harnesses.md). Load existing role choices. If only the legacy shared settings file exists, keep choices that are valid in this client.
2. Inspect the models the native delegation tool accepts. In Claude Code, use confirmed native aliases such as `inherit`, `sonnet`, `opus`, or `haiku` only when available. In Codex, use the models exposed to this session. In OpenCode, use `opencode models`, the connected provider list, and the active agent configuration. Do not read or print credential files. A listed but unconnected provider is not available access.
3. Ask for a reasoning budget only if the user has not supplied one. Offer small, medium, large, and unlimited. Map these to medium, high, xhigh, and max effort only where supported. Keep the native model ID unchanged. If the client has no matching effort control, retain its native setting and say so.
4. Build the role table. Use `inherit-parent` for unconfigured roles. Preserve valid user choices. Let the user adjust the table, then confirm it unless the requested choices already authorize the exact settings. Keep panel lengths explicit. Report when the available models cannot supply different model families.
5. Validate each explicit model against the native tool and provider access. Use `auto` and `inherit-parent` as pstack aliases for omitting a model override. Do not send either alias as a model ID. In Claude Code, the native `inherit` alias also means inheritance.
6. Write only this client's settings file. Start with `# budget: <label> (<supported effort>)`, then write one `<role>: <value>` line per role. Claude Code loads the rule automatically. Codex and OpenCode read their file when a role is selected. Report the path and any unsupported effort or model choices.

OpenCode's `task` tool selects an agent rather than accepting an arbitrary model override. To configure a role on a different model, create a native subagent under the user's OpenCode `agents/` directory with `mode: subagent`, a concise description, and the exact confirmed `model: provider/model-id`. Reference it as `agent:<name>` in the role table. Do not replace an existing agent without including that change in the confirmed table. Do not set permission overrides. An inherited role needs no custom agent and uses `general`.

For example, `how explorer: inherit-parent` works in each client. `how explorer: agent:pstack-explorer` works in OpenCode only after that native agent is configured. A Cursor model name with a reasoning suffix is not a portable model choice.

The verification-skill offers in `setup-pstack` remain optional. Skip them when the project already has appropriate checks or the user asked only to update the installation.
