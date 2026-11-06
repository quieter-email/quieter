# Paper and visual verification

## Match the requested stage

If the user asks to experiment in Paper first, edit Paper first. Code can follow once the requested design is concrete. Do not replace a Paper deliverable with a code implementation and call it finished.

For an explicit Paper-to-code task, preserve equivalent structure, type, colors, states, spacing, and interaction intent across both artifacts. A static design cannot demonstrate all runtime behavior. Use the app to verify scrolling, focus, reflow, and dynamic state.

Use the connected Paper MCP when available. Prefer service plugins and APIs over browser automation. Inspect the actual tool list and access before assuming a tool is connected. Repair authentication or connector setup when practical within the task. If Paper is unavailable, continue useful independent work and state exactly what could not be changed or verified.

## Inspect before drawing

Read the current token/component source and existing approved view. Identify the surface role, content hierarchy, control family, viewport, and states. For new design questions, search Mobbin for real product patterns when available, as the repository requests. Use it for inspiration and interaction precedents. Keep Quieter's system and do not copy another product one-to-one.

A parity task has a different purpose from inspiration. If the user asks to reproduce Quieter exactly, reproduce the actual product, including its shaders, sample content, density, and state. Do not redesign while tracing. If the product has a defect the user asked to fix, distinguish that correction from parity work.

## Author editable structure

Use nested frames and flow layout for sections, rows, columns, and controls. Keep text inside the control that owns its centering. Use a real line height and alignment rather than coordinates that merely look right at one scale.

Ordinary fields, labels, buttons, and Pills should remain editable. Use raster captures for complex shaders or artwork when the user permits a non-editable representation. Do not flatten an entire editable UI into a screenshot because the background is a shader.

Apply the same tokens and geometry to every equivalent view in scope. A token update should propagate to its references. Component instances or a controlled bulk update must cover actual affected nodes. Renaming tokens alone does not prove there are no literal fills, local radius values, or detached copies left.

When tools cannot express shared instances or tokens, keep a clear mapping from design roles to nodes and report how propagation was done. Do not invent component linkage that the design tool does not support.

## Full content and artboards

Product-view artboards should reveal all content for review. Extend the artboard to full scroll height when requested. Keeping the sidebar at the top is acceptable. Do not cut off lower settings, action footers, billing thresholds, calendar hours, or long composer content just to preserve a nominal screen height.

Separate full-content inspection from a realistic viewport capture. A full-height board proves content completeness. A viewport capture proves actual scrolling, sticky headers, overlays, and narrow behavior. Use both where the task needs them.

Keep boards and their labels organized by product area and state. Place variants predictably and use a clear reading order. Distinguish experiments from approved designs. When a particular board is authoritative, record its stable file link and node or artboard ID in the task's evidence so another agent can inspect it.

## Component-system boards

Organize the reference into foundations, component families, states, and product compositions. Do not make one enormous grid of nearly identical cards. Each group should answer which component to use and what changes between its supported variants.

Show the actual public component variants and state behavior. Include surface/color/type/radius references, ordinary controls, compound inputs, selection, overlays, feedback, data display, workspace shells, settings, composers, and mail rows. Use current exports to find the inventory instead of assuming the old board contains every component.

Keep enough white space to compare examples without turning each into an isolated oversized card. Group related sizes and states. Name the role and API clearly. Do not create fake variants to fill a grid or style a showcase example differently from the real product.

Show real compositions with ordinary-user sample data. Billing, usage, teams, keys, auth, and permissions should display customer UI. Debug-only unlimited state is not a reference for the normal product.

## Compare measured edges

Check these separately:

- Panel edge and the adjacent panel gutter.
- Section painted edge and its parent inset.
- Full-width inner layer edge and its derived radius.
- Text and control content alignment.
- First and last item clearance.
- Header/body/footer width.
- Every painted corner, including gradient, focus, hover, and selection layers.
- Control label baseline, icon centering, and long-content behavior.

Record the actual role and values when correcting a discrepancy. Do not eyeball every card independently. A consistent screenshot at one zoom is not proof that radii or insets match structurally.

## Verify in the running application

Prefer the existing connected browser tools or the repository's agent-browser workflow for actual UI interaction. Follow the repository's [local configuration and server-lifecycle rules](../../../../AGENTS.md#local-development-and-debugging). Use an existing safe preview where possible.

Use sample personas and permitted development data. Do not expose keys or private content in screenshots. A browser-only fixture can verify presentation when clearly labeled. It does not prove server persistence or actual sending. Real integration verification must follow its existing guarded setup.

Exercise the changed view, not only its component gallery. Include relevant narrow width, light/dark, keyboard focus, disabled/error state, long text, and opened overlays. For shared changes, pick representative consumers that can reveal different constraints. Expand to every view only when the user requested a full audit or a failure demonstrates broader impact.

Useful scenario checks include changing month labels repeatedly, toggling one/two mail panels, opening a dock beside a virtual list, growing a tokenized prompt, replying inline with all toolbar actions, and showing billing with zeros and overage. Select the scenario that tests the change rather than performing every scenario after a one-line edit.

If the user asks to inspect every view and component, keep a coverage ledger. List pages, variants, states, viewport/theme, pass/fail, and concrete remaining defects. Do not label an entire product complete because a few representative screenshots passed.

## Evidence and limitations

Capture screenshots of the actual final changed state. Include before/after when it makes the difference legible. Prefer native artifact uploads or available service/CLI capabilities for PR images; do not assume browser-only upload is required. Verify that linked images load.

Report what changed in Paper, what changed in code, and what inherited the shared update. State unresolved clipping, parity, runtime, access, or data limitations plainly. Do not call the result pixel-exact without comparing equivalent content, fonts, viewport, scale, theme, and state.

Review screenshots after the final edit, not only before it. Finish any design-tool working-node indicators when the tool supports that lifecycle. Keep intentional app/theme exceptions documented at their source instead of disguising them as accidental differences.
