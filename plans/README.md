# QUIETER-108 motion implementation plans

These plans implement the main-app motion consistency pass from commit `96e4ceb2`.

| #   | Plan                                         | Severity | Status |
| --- | -------------------------------------------- | -------- | ------ |
| 001 | Establish the app motion vocabulary          | HIGH     | DONE   |
| 002 | Make the sidebar entrance meaningful once    | HIGH     | DONE   |
| 003 | Polish mailbox switcher states and entrances | HIGH     | DONE   |
| 004 | Align mail list and message motion           | HIGH     | DONE   |
| 005 | Align chat semantic motion                   | HIGH     | DONE   |

## Recommended execution order

1. `001` establishes values and reduced-motion semantics.
2. `002` and `003` consume those values for navigation and mailbox switching.
3. `004` applies the vocabulary to mail list/detail while preserving virtual-list behavior.
4. `005` applies the vocabulary to semantic chat state while preserving streaming behavior.
5. Run the specialized animation review across the complete diff, then React Doctor and the full
   repository verification workflow.

## Dependencies

- Plans `002`–`005` depend on `001`.
- `003` reuses navigation surfaces refined by `002`.
- `004` and `005` are otherwise independent.
