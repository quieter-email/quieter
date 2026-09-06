# Backend behavior and contracts

Additional findings at the original application baseline. Pinned source links support the reported behavior; validation distinguishes local reproductions from source-only traces.

## F67

### P1: Backfill ownership is checked after another mailbox's batch runs

Locations: [rules/service.ts:506](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L506), [rules/service.ts:516](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L516), [rules/service.ts:372](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L372).

`getManagedRuleBackfill` authorizes the caller as manager of the supplied `mailboxId`, then invokes `processManagedBackfillBatch(backfillId)`. That function selects the job using its ID alone and executes rules using the mailbox and rule stored on that job. Only after execution does the caller compare `updated.mailboxId` with the authorized mailbox.

A manager of mailbox A who knows an active backfill ID for mailbox B can advance B's job, including read-state, folder, label, and configured forwarding actions, before receiving NOT_FOUND. Knowing B's job ID is a prerequisite; this audit did not establish an ID discovery path or a disclosure in the response. The job ID must nevertheless not substitute for authorization.

Simplest correction: pass the authorized mailbox ID into processing and select the job by both IDs before any effects. Keep that condition on job updates too. Verify a mismatched mailbox/job pair causes zero rule executions and zero job updates.

## F68

### P2: Reading backfill status is the scheduler, and processing stops without readers

Locations: [managed-organization.ts:52](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/mail/managed-organization.ts#L52), [rules/service.ts:401](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L401), [rules/service.ts:503](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L503), [rules/service.ts:516](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L516).

Starting a job processes at most 100 messages synchronously. The only subsequent caller of the private batch processor is `getManagedRuleBackfill`, explicitly exposed as GET. There is no backend dispatcher for these rows. A mailbox with more than 100 messages stops progressing when status reads stop, while its job remains running and blocks another start. A nominal status read may also send up to a batch's worth of automatic forwards and hold the request open for that work.

Simplest correction: dispatch a bounded batch through the existing backend queue infrastructure, enqueue continuation after a successful checkpoint, and make GET return stored progress only. This does not require another workflow framework. Verify a 101-message job completes without status polling and repeated GETs cause no effects. Separate from F39, which concerns the mailbox-action graph scheduler.

## F69

### P2: Backfill writes can resurrect cancelled jobs and overwrite concurrent progress

Locations: [rules/service.ts:373](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L373), [rules/service.ts:434](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L434), [rules/service.ts:475](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L475), [rules/service.ts:533](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L533), [schema.ts:2251](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L2251).

The batch reads status/counters/cursor, performs work, then updates by job ID alone using the old counters. Cancel can set `cancelled` during that work, only for the batch to overwrite it with `running` or `completed`. Two status readers can also process the same cursor and overwrite each other's counters or later progress. Message-level SKIP LOCKED does not protect the job checkpoint. Starting jobs has a separate read-then-insert active-job check backed only by a nonunique index.

Simplest correction: atomically claim one batch and require the same claim/version plus active status when checkpointing. Preserve cancellation and check it between messages. Add a partial unique constraint for one active backfill per rule and translate contention to CONFLICT. Verify cancellation during a paused batch stays cancelled and two runners cannot own the same batch. These are managed-rule backfills, distinct from F09's mailbox-action leases.

## F70

### P2: Backfill advances past failures without a retry record or useful failure detail

Locations: [rules/service.ts:409](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L409), [rules/service.ts:428](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L428), [rules/service.ts:438](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L438), [schema.ts:2229](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L2229).

Both a returned rule error and a thrown exception increment `errorCount`; the cursor still advances past the entire selected batch. The job can finish as completed with failed messages permanently behind the cursor. The bare catch drops the exception, never reports it, and does not fill the schema's `lastError`. If failure occurs before a rule-application record is written, even that secondary record cannot explain which message failed.

Simplest correction: retain failed message IDs as retryable work before advancing, or stop at the first failure and preserve the retry position. Report unexpected exceptions and persist a bounded diagnostic. Define whether completed-with-errors is terminal or retryable. Verify a transient failure is retried and successful messages are not re-forwarded. This is independent of F07's ingestion early-return problem.

## F71

### P2: Rule preview ORs repeated filter types while execution ANDs every filter

Locations: [search/compiler.ts:274](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L274), [search/compiler.ts:289](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L289), [search/evaluator.ts:229](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/evaluator.ts#L229), [rules/service.ts:322](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L322).

For `matchMode: "all"`, SQL groups filters by type and ORs each group. The in-memory rule evaluator calls `every` over all filters. A rule containing `from:alice@example.com` and `from:bob@example.com` previews Alice's messages but never matches an ordinary Alice-only sender during execution.

The same grouping ORs negative filters. `-from:alice@example.com -from:bob@example.com` therefore admits Alice in SQL because Alice is not Bob, while the rule evaluator excludes Alice. This is more than a misleading preview: normal managed search also uses the SQL compiler.

Simplest correction: specify positive-alternative and negative-exclusion behavior once, then use the same grouping for SQL and in-memory evaluation. If rule "all" means every individual condition, give rule compilation that exact mode instead of reusing ordinary-search grouping implicitly. Verify positive and negative repeated filters against both backends. The isolated fixture confirmed SQL OR versus evaluator false for the Alice example.

## F72

### P2: Accepted `is:archived` conditions never match archived messages in rules

Locations: [search/evaluator.ts:52](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/evaluator.ts#L52), [search/compiler.ts:94](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L94), [mail/search.ts:200](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L200).

The parser recognizes archived and SQL compares `mailboxState` with archived, but `matchesIsFilter` has no archived branch and returns false. A positive archived rule cannot match; a negated archived rule matches even archived messages. An archived-state condition after an earlier archive action is affected too.

Simplest correction: add the missing state branch and make the supported `is` values an exhaustive typed set shared by validation and the two evaluators. Verify both positive and negative archived conditions. The isolated fixture reproduced an archived message returning false while SQL bound the archived state.

## F73

### P2: Separate text matchers disagree on nulls, whitespace, filenames, and free-text semantics

Locations: [search/evaluator.ts:24](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/evaluator.ts#L24), [search/evaluator.ts:157](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/evaluator.ts#L157), [search/evaluator.ts:223](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/evaluator.ts#L223), [search/compiler.ts:182](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L182), [search/compiler.ts:239](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L239), [schema.ts:1788](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L1788).

The JavaScript matcher normalizes whitespace and turns a missing body into an empty string. SQL uses raw subject/body ILIKE and wraps negation around it. With `bodyText = null`, a negative content rule matches in JavaScript, but SQL's nullable NOT ILIKE excludes the row. A subject `Quarterly   report` matches `Quarterly report` in JavaScript but not the raw SQL substring pattern. Both expression mismatches were reproduced without a database.

Free text diverges further. SQL accepts full-text matches or a substring or an attachment filename; the rule evaluator only checks a normalized substring of `searchText`. A filename-only query can appear in preview and never trigger its rule.

Simplest correction: define the rule text contract and implement it consistently. Coalesce nullable text before negation and normalize both sides identically. For rules, either execute the canonical database predicate for each message or deliberately restrict preview and validation to the evaluator's supported subset. Keep product search behavior; avoid introducing a general-purpose homegrown query engine. Verify a small shared corpus against both implementations, including missing bodies and filename-only matches.

## F74

### P2: The rule search assertion accepts invalid filters that SQL silently removes

Locations: [mail/search.ts:23](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/search.ts#L23), [search/normalization.ts:59](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/normalization.ts#L59), [search/compiler.ts:36](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L36), [search/compiler.ts:230](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L230).

`mailSearchFilterSchema` pairs every filter type with an unrestricted string. `assertManagedRuleSearch` only normalizes. A structured header filter with value `X-Account`, missing its colon/value, is accepted and saved. SQL compilation returns undefined for it and removes that condition; with no other conditions the rule preview selects every inbound message. Execution instead evaluates that filter as false. Invalid date/state values have comparable silent-drop paths.

Simplest correction: validate values by filter type at the boundary, using a discriminated union or a focused refinement. Reject invalid header/date/state conditions with a user error; do not erase an accepted condition during compilation. Do not call normalization an assertion. The fixture confirmed acceptance, undefined SQL, and false evaluation for `header:X-Account`.

## F75

### P1: A partly applied rule can invalidate its own match and permanently skip remaining actions

Locations: [rules/evaluator.ts:320](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L320), [rules/evaluator.ts:518](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L518), [rules/evaluator.ts:534](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L534), [rules/evaluator.ts:676](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L676), [rules/evaluator.ts:697](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/evaluator.ts#L697).

Consider a rule matching unread mail with actions mark-read, then forward. The first action updates the message and stores its partial result. A subsequent non-database failure, such as provider rejection, is caught inside the transaction callback, so the earlier database changes commit. The catch always records `matched: false`, because its local `matched` is a constant false.

A later application reads the partial results but re-evaluates the predicate against the now-read message. The condition is false, so it skips the remaining forward and persists an unmatched result with an empty action history. Retry bookkeeping therefore fails even when the provider definitely rejected the forward. No uncertain provider acceptance is required.

Simplest correction: persist a successful match against a specific rule revision before applying actions. Resume incomplete actions using that match, rather than re-testing the mutated message; retain the true match state on failure. Verify mark-read succeeds, forwarding rejects once, then retry completes the forward while retaining the first action's history. This is a different failure from F08's mailbox-action replay identity and F03's accepted-send persistence.

## F76

### P2: Label renames and deletions leave saved searches and rule predicates inconsistent

Locations: [labels/service.ts:154](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/labels/service.ts#L154), [labels/service.ts:269](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/labels/service.ts#L269), [labels/service.ts:323](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/labels/service.ts#L323), [search/compiler.ts:74](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/search/compiler.ts#L74).

Search supports label names and IDs. Renaming a label updates only the label row, so a saved view or rule stored with the old name silently stops matching. Deletion rewrites saved views only when a label filter equals the deleted name, leaving ID-based filters dangling. Rule cleanup only inspects action IDs and legacy `labelIds`; it never inspects `rule.search` or `conditionGroups`.

A deleted label predicate can therefore disable a positive rule indefinitely, while a negated reference becomes true for every message lacking the now-impossible label. Removing a positive filter from a multi-filter saved view also broadens its results without flagging that semantic change.

Simplest correction: resolve label references to stable IDs when saving definitions and store names for display separately. On deletion, disable affected views/rules and identify the missing reference rather than silently weakening predicates. Until that representation is migrated, handle name and ID references in every condition group in one transaction. Verify rename, deletion, and negated label conditions. This is a concrete contract divergence, not F35's trivial-helper cleanup.

## F77

### P2: Normal duplicate-name input escapes as an unexpected database error

Locations: [saved-views/service.ts:158](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/saved-views/service.ts#L158), [saved-views/service.ts:207](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/saved-views/service.ts#L207), [labels/service.ts:134](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/labels/service.ts#L134), [rules/service.ts:149](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/rules/service.ts#L149), [schema.ts:2025](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L2025), [schema.ts:2066](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L2066), [schema.ts:2113](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/database/src/schema.ts#L2113).

Labels, saved views, and managed rules have normalized-name uniqueness constraints, but create/rename operations issue their writes without translating those constraint failures. Creating a second `VIP` label or renaming a view to an existing name therefore rejects with the database driver's error instead of a domain CONFLICT. This is ordinary input, including names equivalent after whitespace/case normalization, and does not require concurrency.

Simplest correction: translate the specifically named uniqueness violations to concise CONFLICT messages at these service boundaries. Keep database uniqueness as the authority; a preliminary select alone still races. A small shared translator for these domain constraints is enough. Verify create and rename collisions while keeping unrelated database failures unexpected.

## F78

### P1: Interactive memory requests bypass entitlement and balance checks

Locations: [routers/ai.ts:191](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/ai.ts#L191), [routers/ai.ts:206](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/ai.ts#L206), [ai-memory.ts:831](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/ai-memory.ts#L831), [ai-memory.ts:864](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/ai-memory.ts#L864), [ai-memory.ts:950](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/ai-memory.ts#L950), [billing/index.ts:438](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/billing/src/index.ts#L438).

`interactMemory` checks target access and whether a billing mailbox string is nonempty, then calls `requestAiMemoryUpdate`, which invokes the model directly. Neither path checks `assertCanUseAi` or the memory module's existing `canRunMemoryModel`. Usage is considered only afterward. A user with an exhausted balance or no active AI entitlement can still generate paid memory responses.

For personal scope, `assertMemoryTarget` returns immediately, yet the schema accepts a caller-supplied `mailboxId`. A nonempty nonexistent mailbox ID satisfies the router and later makes billing attribution return without recording usage. The personal memory itself remains scoped to the authenticated user; this is not a claim of reading another user's memory.

Simplest correction: resolve and authorize the billing mailbox even for personal scope, then enforce its organization's entitlement/balance before invoking the model. Reuse the existing AI gate. Reject missing/unavailable attribution rather than treating a nonempty string as sufficient. Verify exhausted balance, no entitlement, and a fabricated mailbox ID all produce zero model calls. Separate from F11, which only identified missing enforcement in mailbox actions.

## F79

### P2: Memory RPCs turn arbitrary backend failures into verbatim user errors

Locations: [routers/ai.ts:140](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/ai.ts#L140), [routers/ai.ts:223](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/ai.ts#L223), [routers/ai.ts:333](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/ai.ts#L333), [ai-memory.ts:896](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/ai-memory.ts#L896).

`toUserMemoryError` converts every non-ORPC exception into BAD_REQUEST using `error.message`. Database failures, provider errors, and programming exceptions become expected user input failures. The affected catch blocks do not report these unexpected exceptions. The memory service writes some failures to its change log and rethrows, but does not classify them for the RPC boundary.

Besides hiding the problem from unexpected-error monitoring, a driver error containing SQL or parameters can reach the client as a message explicitly marked safe to display verbatim. No actual secret-bearing error was triggered in this audit.

Simplest correction: use typed domain errors for expected memory conflicts and validation. Preserve known ORPC errors; report all other exceptions and return a generic INTERNAL_SERVER_ERROR. Do not infer user-safe text from the existence of an Error message. Verify a provider exception is reported and its internal detail is absent from the returned error. This is a separate classification defect from F26's reporter context loss.
