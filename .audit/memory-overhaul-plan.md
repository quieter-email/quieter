# Memory overhaul workflow

- [x] Read the Principles section of poteto-mode.
- [x] Phase A: Frame.
- [x] Phase B: Design the workflow.
- [x] Phase C: Run the loop.
- [x] Phase D: Keep the audit trail.
- [x] Phase E: Verify and hand back. Local verification and evidence review are complete. The PR and final chat response record delivery after this committed snapshot.

## Done when

Plain-text, categorized knowledge learns from incoming and outgoing mail, onboarding samples, meaningful mail interactions and user chat. All contextual AI consumers receive bounded, task-specific context through the central access-checked loader. Settings can search, add, edit and permanently delete individual facts. Retry, pause, reset and concurrent write behavior preserve ownership and deletion. The local validation suite, boundary checks, migration checks and focused behavioral tests pass, and a reviewed PR is pushed without deploying or mutating production data.

## Units

1. Map current capture, storage, consumers and settings; compare two designs.
2. Replace vector recall with categorized plain text and task/correspondent selection; strengthen write/deletion races.
3. Capture actual mail text and seed incoming and sent samples; keep events durable and retryable.
4. Wire missing consumers, private-owner background context and live calendar reads.
5. Ship searchable fact management and explicit chat additions without approval.
6. Verify migration, isolation, extraction, context selection, settings and runtime bundles locally.
7. Independently review, resolve findings, synchronize main, commit, push and open a PR.

## Constraints

No production migration, deploy or shared Gmail provider mutation. Existing memory data may be discarded, but database rollout must remain expand/contract safe. Run paid CI at most for the completed PR and avoid intermediate pushes.

## Requested follow-up

The nine review findings are fixed in `8aefc76c`. The user's follow-up adds current sender/domain label evidence, reusable context selection for future features, and an inline memory browser inspired by the supplied reference.

The history contract is the first dependency. It separates exact sender and same-domain samples, current labels, confirmed automatic applications and known user corrections. A provider-neutral type lets both automation paths consume the same evidence without turning sampled history into permanent facts or another model call.

Three independent units own disjoint files: history reads and tests; shared context selection, scoped category counts and documentation; inline settings UI. The parent wires both classifiers, removes the old sender-only helper, verifies the running UI and integrates the result. Shared database tests use unique loopback fixtures without resets. Only the parent commits and pushes.

- [x] Settle the history and category-count contracts.
- [x] Implement bounded provider history and central context selection.
- [x] Migrate both classifiers and replace the memory dialog with inline grouped facts.
- [x] Inspect light, dark and narrow UI; exercise CRUD and scope selection.
- [x] Complete independent review, focused integration checks, full local tests and deployment bundles.
- [x] Synchronize main and prepare one completed PR update with evidence. Live CI and review-thread completion remain recorded on PR 402.
