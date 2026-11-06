# Source map and compatibility

## Resolve the intended design

The design-system guide owns maintained specifications. The product references in this skill explain design choices and exceptions. Existing implementation is evidence of a contract, not proof that every view already follows the intended design.

Use the latest explicit request for the current task. For unstated decisions, use the settled rules in this skill and current shared contracts. Compare the current approved Paper design with the real UI. If they disagree, identify the specific difference and the version that introduced it. Do not silently choose an old screenshot, a temporary experiment, or whichever file is easiest to edit.

This skill's canonical version is `.agents/skills/quieter-design/` in the Quieter repository. Existing client discovery links to `.agents/skills` make it available alongside other project skills. Do not maintain a second hand-edited user-level copy.

Paths below are relative to the Quieter repository, not this skill directory. Locate the active checkout and verify APIs at the branch you are changing.

## Find the structural owner

| Concern | Source |
| --- | --- |
| Repository rules | [AGENTS.md](../../../../AGENTS.md) |
| Design guide | [Design system](../../../../docs/design-system.md) |
| Colors, type, radii, shadows, corner shaping | [styles.css](../../../../packages/ui/src/styles.css) |
| Shared theme definitions and geometry | [brand-themes.ts](../../../../packages/ui/src/lib/brand-themes.ts), `brand-geometry.ts` |
| Generated theme CSS | `packages/ui/src/brand-palettes.generated.css` |
| Class merging and registered text scale | `packages/ui/src/lib/cn.ts` |
| Public component export names | `packages/ui/package.json` |
| Shared appearance | `packages/ui/src/components/ui/` |
| Live gallery and real compositions | `packages/app/src/features/design-system/components/design-system-showcase.tsx` |
| Product settings adapter and anchors | `packages/app/src/features/settings/components/settings-layout.tsx` |
| Mail layout preference | `packages/app/src/features/settings/domain/mail-layout-setting.ts` |
| Mail list, virtualizer, states | `packages/app/src/features/message-list/` |
| Reading, inline reply, recent activity | `packages/app/src/features/message-thread/`, `packages/app/src/components/empty-message-state.tsx` |
| Labels manager | `packages/app/src/features/message-labels/components/labels-workspace-panel.tsx` |
| Compose and snippets | `packages/app/src/features/compose/` |
| Calendar | `packages/app/src/features/calendar/`, shared `schedule.tsx` |
| Chat and dock | `packages/app/src/features/chat/`, shared `workspace-dock.tsx` |
| Settings, billing, delivery | `packages/app/src/features/settings/components/`, especially `organization-settings/` |
| Account billing scope | `packages/app/src/features/settings/components/account-billing-panel.tsx` |
| Actual usage composition and segmented bar | `packages/app/src/features/settings/components/organization-settings/organization-mail-usage-settings.tsx`, `ManagedUsageSummary` |
| Shortcut menu | `packages/app/src/features/hotkeys/components/keyboard-shortcuts-dialog.tsx` |
| Thread navigation | Shared `thread-rail.tsx` and product integration on current main |
| Growth views in PR #389 | `packages/app/src/features/broadcasts/components/`; audience, template, campaign, and unsubscribe policy files share this directory |
| Public unsubscribe in PR #389 | `apps/web/src/components/unsubscribe-document.tsx`, `apps/web/src/routes/unsubscribe.$token.ts`, `apps/web/src/lib/unsubscribe-request.server.ts` |
| Landing and shaders | `apps/web/src/features/home/`, its `home.css`, and imported shader/artwork sources |
| Public footer | `apps/web/src/components/site-footer.tsx` and `apps/web/src/routes/_public.tsx` |
| Auth and onboarding | `packages/app/src/components/auth-layout.tsx`, `apps/web/src/components/auth-screen.tsx`, `packages/app/src/features/onboarding/` |
| Motion orchestration | `packages/app/src/features/motion/`, shared `motion.ts` |

Use `rg --files` and `rg` when a feature moved. A missing path is a prompt to find the current owner, not to rebuild an old component locally.

## Compatibility snapshots

The shared API baseline is [main at f3e1f2d7](https://github.com/quieter-email/quieter/tree/f3e1f2d7160c36b0723cd8c88df7402f3d0ec2ad). That revision includes category foreground pairs, floating tooltip treatment, and `ThreadRail`. It excludes the old `content-section` and `email-editor` UI exports and obsolete settings variants. Check public exports rather than reviving a removed API to make an older example compile.

Growth and public campaign-unsubscribe patterns refer to [PR #389](https://github.com/quieter-email/quieter/pull/389), with a concrete source snapshot at [2e6b3cb7](https://github.com/quieter-email/quieter/tree/2e6b3cb715a58509d10d49c50ed9b5d57a508e43). Those feature paths are absent from the shared API baseline above. Check their availability in the target branch, and do not add an entire missing feature during unrelated design work.

## Keep this skill current

Update the appropriate reference when the user changes a design rule or a shared contract intentionally changes. Keep the rule, the source pointer, and its meaningful exception together. Do not append every review comment as a universal prohibition.

Reconcile old examples when updating tokens or APIs. A documentation snapshot must not block an intentional approved redesign. Record a concrete unresolved conflict in the handoff instead of inventing missing intent or claiming perfect parity.
