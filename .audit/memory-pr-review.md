# PR 402 review follow-up

The original CI run passed. The follow-up addresses all nine inline findings from CodeRabbit and Codex on the original memory commit.

| Finding | Result |
| --- | --- |
| Opens and AI reads disappear after sync deduplication | Keep one canonical message event and separate deduplicated engagement events. Supporting message content is marked `messageContextOnly`. |
| Delayed sender hydration leaves label knowledge stale | Refresh after a missing source is filled, using the original authorized actor and scope revision. Delete/reset and ownership changes remain fenced. |
| Inaccessible managed memory actor breaks ingestion | Expected mailbox `NOT_FOUND` skips learning. Durable database failures remain retryable. Delivery notifications and other post-processing still run. |
| Memory queue failures break successful mail actions | Report sanitized failures and continue unaffected message IDs. |
| Chat receives malformed compose tool input | Use schema `safeParse` before provenance; let the SDK emit its tool error and recover the response. |
| Memory capture delays thread reads | Use the existing request background scheduler, with an awaited fallback for callers without one. |
| Memory setup failure rejects completed onboarding | Filter current managed-mailbox membership and isolate all post-commit queue work. Other eligible inboxes still queue. |
| Failure status and pending-count text conflict | Show a retry badge and non-success tone for failures; use singular text for one observation. |
| Tool-free generators receive a memory-tool hint | Include the additional-recall tool hint only for chat. |

Focused regressions reproduced the prior capture boundary failures, missing PostgreSQL engagement, missing sender-specific context, invalid compose stream failures, blocked thread reads and rejected onboarding. The repaired paths pass their focused suites. The label tests also hold hydration across individual deletion, full reset and ownership transfer.

Independent review found that a source update could commit before a failed profile refresh was swallowed. Hydration now propagates that failure for the worker to retry, and matching feedback remains eligible for refresh after its source has been filled. A regression fails one refresh, retries hydration without another label action, and verifies the resulting sender-specific context.

Final local validation passed 1,198 tests across 175 files with disposable loopback PostgreSQL. Full formatting, lint and type checks passed with the same three existing React Compiler warnings; the final retry change also passed its targeted checks. Import boundaries passed for 760 files and manifests, and all three AWS handlers and five Cloudflare Workers bundled. The disposable migration chain was verified before the regression runs. No additional schema change was needed.

The CodeRabbit docstring coverage suggestion conflicts with the repository's instruction to keep comments minimal. No blanket docstrings or policy changes were added.

No provider mutations, production changes, deployments or manual GitHub Actions dispatches were used. The pre-existing environment setup edit and concurrent dependency lockfile update remain outside this commit.
