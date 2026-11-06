# Sources and decision history

## Resolve the intended design

This skill was assembled on November 6, 2026 from the user's design work in this chat, the Quieter guide and implementations, and the fetched repository sources. It is a reviewable record, not proof that every existing implementation already follows every rule.

Use the latest explicit request for the current task. For unstated decisions, use the settled rules in this skill and current shared contracts. Compare the current approved Paper design with the real UI. If they disagree, identify the specific difference and the version that introduced it. Do not silently choose an old screenshot, a temporary experiment, or whichever file is easiest to edit.

Source baselines inspected during authoring:

- `origin/main` at `f3e1f2d7`, including the November 6 thread navigation and recent light-theme changes.
- The attached feature worktree at `2e6b3cb7` for audiences, campaigns, templates, and unsubscribe policy. Its fetched remote tip was `46855602` and contained later template-authoring work.
- `docs/design-system.md`, `AGENTS.md`, and the actual shared UI sources. Runtime parity was not re-audited for the skill-authoring task.

This skill's canonical version is `.agents/skills/quieter-design/` in the Quieter repository. Existing client discovery links to `.agents/skills` make it available alongside other project skills. Do not maintain a second hand-edited user-level copy.

Paths below are relative to the Quieter repository, not this skill directory. Locate the active checkout instead of hardcoding the author's Windows worktree. Verify APIs at the branch you are changing.

## Find the structural owner

| Concern | Source |
| --- | --- |
| Repository rules | `AGENTS.md` |
| Design guide | `docs/design-system.md` |
| Colors, type, radii, shadows, corner shaping | `packages/ui/src/styles.css` |
| Shared theme definitions and geometry | `packages/ui/src/lib/brand-themes.ts`, `brand-geometry.ts` |
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
| Growth views in the feature branch | `packages/app/src/features/broadcasts/components/`; audience, template, campaign, and unsubscribe policy files share this directory |
| Public unsubscribe in the feature branch | `apps/web/src/components/unsubscribe-document.tsx`, `apps/web/src/routes/unsubscribe.$token.ts`, `apps/web/src/lib/unsubscribe-request.server.ts` |
| Landing and shaders | `apps/web/src/features/home/`, its `home.css`, and imported shader/artwork sources |
| Public footer | `apps/web/src/components/site-footer.tsx` and `apps/web/src/routes/_public.tsx` |
| Auth and onboarding | `packages/app/src/components/auth-layout.tsx`, `apps/web/src/components/auth-screen.tsx`, `packages/app/src/features/onboarding/` |
| Motion orchestration | `packages/app/src/features/motion/`, shared `motion.ts` |

Use `rg --files` and `rg` when a feature moved. A missing path is a prompt to find the current owner, not to rebuild an old component locally.

The growth and public campaign-unsubscribe feature paths were present in the attached PR worktree but absent from the inspected `main`. Their design patterns are retained here for that work. Do not reintroduce the whole feature during an unrelated task on a branch where it has not landed.

Recent source changes matter when using older references. Current main removed `content-section` and `email-editor` exports from `@quieter/ui`, removed obsolete settings variants, moved tooltips to the floating popup treatment, and added category foreground pairs and `ThreadRail`. Do not resurrect a removed export to make an older example compile.

## Settled choices and the experiments they replace

| Topic | Retained decision | Do not revive |
| --- | --- | --- |
| Palette | Four clear neutral surface roles plus the complete semantic palette | A four-token palette that removes primary, secondary, or foregrounds |
| Neutral duplicates | Consolidate needless visual steps at the token owner | Separate almost-identical feature grays or deleting semantic aliases solely because values match |
| Hierarchy | Subtle shade layers with restrained rounding and established shadows | Embossed, inset, clay-like, heavily shadowed treatment |
| Borders | Remove decorative edges while preserving meaningful state and structure | A border around every filled group, or deleting all calendar and focus edges |
| Mail header | Rounded inset Section tray containing interactable controls | A brighter full-width unrounded band |
| Rows | Transparent idle list rows with a coherent rounded selected or hovered state | Every row painted as a separate rectangular card |
| Radius | Shared role-based radii and derived full-width inner contours | Arbitrary radii per card, pill-shaped sections, or one radius forced onto every size |
| Insets | Small shade-to-shade inset, distinct from internal content padding | Alternating tiny and broad frames for otherwise equivalent sibling sections |
| Settings padding | Shared balanced row layout and narrow-screen behavior | Per-row tweaks, action-to-edge imbalance, or double padding |
| Composer | Section editor body with inset Detail toolbar rounded at all corners | Body blending into Panel, a flat-top toolbar, clipped actions, or toolbar spill |
| Calendar | Inset rounded main schedule and a nested rounded header group | Raw square grid against the panel, or a full-bleed Detail band |
| Month navigation | Stable arrow positions through varying month labels | Arrows pushed around by month length |
| Billing | Same surface logic as other settings, clear grouped metrics, deliberate usage chart | Legacy isolated styling or separate metric boxes without a reason |
| Usage bar | Prominent, rounded to the system, room above and below, aligned with its summary | Tiny afterthought, edge-to-edge slab, or maximum-radius capsule |
| Destructive | Red for irreversible loss and meaningful errors | Red disconnect, close, cancel, or every negative-sounding verb |
| Success | Clearly green shared success token | Dull or ambiguous local green alternatives |
| Focus | Discreet keyboard focus with correct modal behavior | Large decorative halos or removing all focus visibility |
| Toggles | Familiar switches and ordinary pressed options | Novel oversized toggle styling or a spinner replacing the thumb |
| Pending toggles | Optimistic when safe, otherwise disable the existing control until completion | A switch loading animation, races, or swallowed failures |
| Empty reading pane | Minimal useful dynamic history, such as recent mail or recent codes | Repeated Compose, Search, or Unread links already one click away |
| Snippets | Use the mail-list grouping logic, transparent idle rows | An unrelated large-inset row card system |
| Component reference | Organize by foundations, control families, states, and compositions | An overwhelming wall of tiny inconsistent examples |
| Sample data | Representative ordinary-user production states | Development-only unlimited billing and debug affordances as the design reference |
| Landing | Shared language with marketing composition, restrained feature and pricing type | Converting every marketing region into a compact workspace tray |
| Waitlist input | A deliberately darker field over atmospheric artwork | The ordinary bright Detail fill overpowering the hero |
| Footer wordmark | Oversized low-opacity text with a subtle fade | A mandatory GPU shader after the user chose ordinary text |
| Landing demos | Small invisible interactions that explain the product | Intrusive instructions, fake production sends, or a full parallel app |
| Paper | Editable view structure, full scroll content, shared logic across boards | Isolated corrections, clipped artboards, or finalizing the discarded `02b Experiment` |

An early mail-row example and several radius/inset experiments were explicitly rejected. Their exact values are not approved defaults. The user's final criticism usually concerned inconsistent roles and excessive treatment, not a request to make all controls smaller.

## Keep this skill current

Update the appropriate reference when the user changes a design rule or a shared contract intentionally changes. Keep the rule, the source pointer, and its meaningful exception together. Do not append every review comment as a universal prohibition.

Reconcile old examples when updating tokens or APIs. A documentation snapshot must not block an intentional approved redesign. Record a concrete unresolved conflict in the handoff instead of inventing missing intent or claiming perfect parity.
