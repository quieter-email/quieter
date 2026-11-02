# Product UI

Follow the root design-system policy and [component guide](../../../docs/design-system.md).

- Start with the component source, `/design-system`, and the closest existing product flow. Reuse established density and layout.
- Import controls from `@quieter/ui`. Keep app wrappers for data, navigation, anchors, and domain behavior; put reusable visual recipes in `packages/ui`.
- Pass shared size, variant, chrome, and tone props instead of overriding their result. Put spacing between controls on their parent. Do not hide restyling in a local `cva`, wrapper, CSS selector, or forwarded `className`.
- Use `InputGroup` with an attached input for compound address fields, `Pill` for status/category badges, the settings layout exports for settings, and `ActionFooter` or overlay footers for finishing actions.
- Keep native controls when browser behavior or a specialized editor requires them, such as hidden file pickers and the structured search editor. Ordinary buttons and fields use shared controls.
- A one-off exception needs a specific reason. If the same exception occurs in multiple flows, fix the shared API or composition. Do not add lint restrictions for design-system adoption.
- The landing page is outside this maintenance scope. Do not restyle `features/home` or its shared controls through global changes.
