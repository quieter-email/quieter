---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when the user asks to build web components, pages, artifacts, posters, or applications (examples include websites, landing pages, dashboards, React components, HTML/CSS layouts, or when styling/beautifying any web UI). Generates creative, polished code and UI design that avoids generic AI aesthetics.
license: Complete terms in LICENSE.txt
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and choose an interaction that fits the task:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Existing product**: Follow its design system, shared components, navigation, density, and established interaction patterns. Use references to understand a useful interaction, not to copy an entire interface.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Editing flow**: For multi-field creation and editing, use the product's established dialogs or dedicated screens. Do not interpret a request for simplicity as a request to put forms inside list rows. Keep lists stable during editing unless the user requests inline editing or the existing flow clearly calls for it.
- **New visual direction**: When the user asks for a new identity or a standalone expressive page, choose an aesthetic that fits its audience and purpose.

Prioritize clear hierarchy, recognizable controls, and a coherent flow. Distinctive visual choices should serve the task.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Clear and easy to use
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Use the existing product's fonts and type scale. For a new visual identity, choose typography suited to its purpose and audience.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Follow existing motion patterns. Animate changes when motion helps explain state or preserve context, and respect reduced-motion preferences.
- **Spatial Composition**: Use predictable layouts, consistent alignment, and purposeful spacing. Keep primary actions easy to find and avoid making a list shift around when a separate editor is more appropriate.
- **Backgrounds & Visual Details**: Follow the existing product's surfaces and tokens. Add decoration only when it supports an explicitly requested visual direction.

Use standard component patterns when they make the interface easier to understand. Do not reject a familiar pattern or change an existing design system just to make the result unusual.

Scale the design to the request. A settings screen usually needs clear organization and good editing flows, not a new visual identity.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.
