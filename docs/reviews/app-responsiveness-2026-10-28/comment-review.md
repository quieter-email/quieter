Read-only comment review passed for `06b3247d..8d2ff77d`, covering commits `93b77177` and `8d2ff77d`. No source edits. Deletion count 0. No MUST KILL or REVIEW findings.

- KEEP `workspace-component-loaders.ts:4`. The suppression preserves the observed promise's identity. The [Oxc rule](https://raw.githubusercontent.com/oxc-project/oxc/main/crates/oxc_linter/src/rules/typescript/promise_function_async.rs) requires `async` broadly; applying it here creates a separate promise and defeats the rejection observer. [JavaScript async function semantics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/async_function) confirm that separate promise.
- KEEP `workspace-component-loaders.ts:7`. It explains why observing a rejected preload must preserve rejection for mounted consumers. [Promise.allSettled semantics](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/allSettled) support the explanation.
- KEEP `mailbox-workspace-content.tsx:214`. This explains an external React constraint. [React's Suspense caveats](https://react.dev/reference/react/Suspense#caveats) document reveal throttling and that effect-based loading does not activate Suspense.
- ENCODE already present. The three public-loader test cases exercise ignored preload failures followed by mounted-consumer rejection. No additional encoding requested.

Skipped application behavior review and feature retesting as scoped. The scroll-anchor commit adds no comments or suppressions. No agents, services, source changes, git mutations, or external writes.
