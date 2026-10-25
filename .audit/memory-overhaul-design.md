# Memory design decision

Two independent candidates compared canonical categorized facts with a richer fact-plus-summary design. An independent judge preferred canonical facts. Both candidate authors reached that recommendation too.

The chosen design keeps one authoritative text record per concept, exact correspondent applicability, and a category budget for every AI task. SQL searches each complete authorized scope for relevant categories, text and contacts. The learner merges evidence into concepts. A separate summary cache was rejected because it adds another copy of private facts to invalidate on edit, deletion and expiry.

The implementation preserves the durable event worker, user/mailbox locks, optimistic versions and atomic event completion. Scope revision invalidates stale writers. Stable source IDs remain as scrubbed tombstones after forgetting, so provider replay cannot restore deleted text. Ordinary future evidence may establish a new fact; topic suppression is not implemented.

The independent review found and triggered fixes for background modification of manual preferences, paused-owner bootstrap starvation, context loss on later mail actions, generated-writing provenance, relationship references without known addresses, mailbox-scoped chat additions, and progress reporting before learning completes.

Validation uses a disposable PostgreSQL container, mocked external I/O for concurrency scenarios, synthetic text in a budget-limited development model check, and the real settings UI with a synthetic local account. Provider mutation tests and production deployment are outside this task. Production query patterns were inspected through PlanetScale Insights. The connector could not read quieter_dev, so no claim is made about its live data.
