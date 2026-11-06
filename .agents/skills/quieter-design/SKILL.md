---
name: quieter-design
description: "Design, implement, or review Quieter interfaces and shared components using its surface hierarchy, geometry, interaction rules, and Paper-to-code workflow. Use for Quieter product views, settings, mail, calendar, chat, auth, marketing, and design-system work."
---

# Quieter design

Preserve Quieter's calm, modern, dense interface. Build hierarchy with Canvas, Panel, Section, and Detail shades. Use restrained rounded corners, consistent alignment, and shared components. Avoid clay effects, decorative borders, oversized headings, and a card around every item.

This skill records settled product decisions and the reasons behind them. It does not authorize unrelated redesigns, production writes, sending mail, deployment, or merging. A new user instruction can change the design direction. Apply that change to its actual shared owners and report its reach.

## Start with the actual system

1. Locate the Quieter checkout and read its `AGENTS.md` and `docs/design-system.md`.
2. Read the relevant `packages/ui` implementation, its public export, its `/design-system` example, and the closest real product caller. Upstream shadcn APIs are not this project's API.
3. Read [foundations](references/foundations.md) for palette, shape, typography, and spacing decisions. Then read only the task-relevant references below.
4. Classify each gap as a shared appearance defect, a product layout defect, a missing state, or a real exception. Fix it at that owner.

The working code, current theme definitions, latest approved design, and current user request must agree. [Sources and decision history](references/sources-and-decisions.md) explains how to resolve stale screenshots, old experiments, and branch differences. Never turn a known defect in the current code into a design requirement.

## Rules that shape every view

- Keep semantic primary, secondary, foreground, muted, state, focus, and categorical roles. The four surfaces reduce duplicate grays, not the meaning of the palette.
- Separate **layer inset** from **content padding**. A 2px nested shade gap and a 16px or 24px text inset solve different problems. Do not replace one with the other.
- Use the radius for the element's role. A full-width inset layer follows the outer contour. A small button or pill keeps its control radius. Consistency does not mean one radius everywhere.
- Group related controls in a Section. Use Detail for controls, selected states, nested summaries, and a few substantial information groups. Lists normally leave unselected rows transparent.
- Shared props own appearance. App layout owns placement, available width, external gaps, and domain behavior. Do not override a component's padding, fill, type, radius, shadow, or interaction styling at a call site.
- Keep real content in normal flow. Use measured positioning for calendars, virtualized rows, floating windows, and graphics where the interaction requires it. Never position ordinary text to fake centering.
- Prefer subtle keyboard focus and ordinary optimistic toggles. Preserve keyboard visibility, focus management, error feedback, and accessible names.
- Use `cursor: default` for controls and same-view navigation. Reserve `cursor: pointer` for unmistakable links to a different page. An anchor, changed search params, or support for opening a new tab does not by itself warrant a pointer.
- Apply a shared change to all relevant consumers, examples, themes, and approved Paper views within the task's scope. Report what changed and where. Do not claim a global migration after editing one screen.
- Preserve existing density, behavior, and information hierarchy during polish. Make the requested correction without restarting a visual experiment.

## Read the reference for the job

| Job | Read |
| --- | --- |
| Choose colors, typography, spacing, insets, or corners | [Foundations](references/foundations.md) |
| Choose a component, variant, control state, overlay, or footer | [Components and states](references/components-and-states.md) |
| Work on mail, composers, calendar, chat, snippets, or thread navigation | [Workspace patterns](references/workspace-patterns.md) |
| Work on settings, tables, billing, delivery, auth, onboarding, growth, or marketing | [Settings and other product patterns](references/settings-and-product-patterns.md) |
| Change shared APIs, implement a design, wire data, or manage themes | [Implementation rules](references/implementation.md) |
| Design in Paper, reproduce a view, or compare Paper with a running app | [Paper and visual verification](references/paper-and-verification.md) |
| Audit an interface or finish a broad sweep | [Review checklist](references/review-checklist.md) |
| Resolve conflicting old feedback or find source files | [Sources and decision history](references/sources-and-decisions.md) |

Read both visual and implementation references when changing a shared component. A view-level task also needs its product pattern. For a full-system audit, use all references and keep an explicit coverage list of views and states.

## Finish at the right scale

Check the changed treatment in its real context and relevant states. A routine token or prop correction needs a focused diff and visual check when appearance is uncertain. Substantial behavior, security, concurrency, migrations, or broad uncertain refactors need the repository's stronger checks. Do not write tests that freeze wording or visual constants.

In the handoff, say what the user now sees, what shared component or token changed, which other views inherited it, what you inspected, and any real remaining mismatch. Keep unsupported claims about pixel parity, accessibility, or full coverage out of the report.
