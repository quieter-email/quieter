# Responsive mail baseline

Quieter's responsive web mail experience is the interaction baseline for future native or mobile shells. Mobile implementations should reuse the same mailbox-scoped navigation, search state, selection semantics, thread reading, and message actions rather than introduce a parallel workflow.

At narrow component widths:

- Message lists keep compact, consistent edge spacing and preserve safe-area padding.
- Search, filter, context, and action menus stay inside the visible viewport and scroll internally.
- Reply, Reply all, Forward, and secondary message actions expose visible text labels.
- Icon-only controls retain concise accessible names and the shared tooltip behavior.
- Primary controls have touch-friendly targets and do not require hover to discover or activate.

Use container queries when a mail component's own width determines its layout. Viewport queries remain appropriate for the page shell, mobile sidebar, and navigation history behavior.
