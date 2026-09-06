# Additional code quality findings

This second pass separates small consistency corrections from behavioral defects. Evidence refers to the same application baseline as the first report. Recommendations are scoped; they do not authorize a broad rewrite.

## F42

### P1: Connector token handling is duplicated, and the copies already disagree

Evidence: [packages/orpc/src/connectors/service.ts:772](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/service.ts#L772), [packages/orpc/src/connectors/service.ts:847](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/service.ts#L847), [packages/orpc/src/connectors/runtime.ts:216](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L216), [packages/orpc/src/routers/connectors.ts:23](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/connectors.ts#L23), [packages/orpc/src/connectors/service.ts:1059](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/service.ts#L1059), [packages/orpc/src/connectors/runtime.ts:537](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L537), [packages/orpc/tests/local-connector-isolation.test.ts:12](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/tests/local-connector-isolation.test.ts#L12).

The settings service retains its own OAuth configuration, encryption wrappers, refresh, authorization, and calendar normalization alongside runtime.ts. These are live paths: importing a calendar attachment uses service.ts, while AI tools use runtime.ts. When refresh omits scope, service.ts writes the current requested scopes and connected status; runtime.ts preserves the stored grant. The service therefore claims permissions the response did not grant. Thirteen exact duplicate function groups occur between these two files, in addition to near-duplicate refresh implementations. The duplicate Calendar POST also omits the local observe-mode/account-allowlist guard present in runtime.ts. An isolated call to the actual ICS import in local observe mode with no allowed Calendar accounts reached the mocked Calendar import POST and returned success. No provider request was made. The existing isolation suite exercises the other writer and misses this path.

**Correction:** Make runtime.ts the single credential execution path and have connection management call it. Keep OAuth setup/callback lifecycle in service.ts. Preserve actual granted scopes; remove the obsolete exported runtime copies after updating callers. Preserve create-versus-import semantics while routing both through the guarded transport; a local read-only profile must cover every writer.

**Validation:** Exercise attachment import and an AI calendar action with a refresh response that omits scope; both must preserve the stored grant. The mocked observe-mode bypass was reproduced. Add a regression through the ICS service/router that asserts no Calendar write and includes the primary-calendar account check.

## F43

### P2: A refresh marks a connector unusable but still hands its token to the action

Evidence: [packages/orpc/src/connectors/runtime.ts:313](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L313), [packages/orpc/src/connectors/runtime.ts:320](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L320), [packages/orpc/src/connectors/runtime.ts:358](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L358), [packages/orpc/src/connectors/runtime.ts:454](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L454).

When required scopes are missing, refresh writes needs_reconnect and then returns the access token anyway. The current runner proceeds; only a later request sees the repair state. Cached-token paths also check stored status without validating the stored scopes against the current definition. This contradicts the comment that insufficient grants will be caught before the first failing action. It is an inconsistent repair contract, not a provider permission bypass.

**Correction:** Use one grant check before returning either a cached or refreshed token. If the product intentionally permits read-only use of a narrower grant, express required scopes per operation rather than marking the whole connector unusable while continuing the action.

**Validation:** A cached or refreshed insufficient grant must follow the same explicitly chosen behavior and must not unexpectedly invoke a write runner.

## F44

### P2: Connector cancellation stops at the token-refresh boundary

Evidence: [packages/orpc/src/connectors/runtime.ts:247](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L247), [packages/orpc/src/connectors/runtime.ts:393](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L393), [packages/orpc/src/connectors/service.ts:786](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/service.ts#L786).

Public execution inputs accept AbortSignal and forward it to the provider action, but token acquisition and refresh have neither the caller signal nor a timeout. Cancelling chat or a mailbox action can leave it waiting on a token endpoint; credential work continues before the already-aborted action is attempted. Linear identity lookup in the same module already has a bounded timeout.

**Correction:** Propagate the signal through credential acquisition and combine it with a bounded refresh timeout. Check cancellation before retrying. Apply the fix in the consolidated implementation from F42.

**Validation:** An aborted token request settles promptly, does not invoke the action runner, and does not misclassify an abort as a revoked grant.

## F45

### P2: Omitting an optional owner silently widens connector authorization

Evidence: [packages/orpc/src/connectors/runtime.ts:411](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L411), [packages/orpc/src/connectors/runtime.ts:431](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L431), [packages/orpc/src/connectors/agent-tools.ts:85](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/agent-tools.ts#L85), [packages/orpc/src/connectors/linear-mcp.ts:243](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/linear-mcp.ts#L243).

Credential execution takes userId?: string. Omitting it removes the owner predicate altogether. That behavior is intentional for previously authorized background work, but the same shape is exposed through the general connector adapters. A future caller can accidentally bypass the owner check simply by forgetting one optional property. No exploitable caller path is claimed here.

**Correction:** Require the owner for user-facing execution. Give trusted background execution an explicit, narrowly exposed entry point or an authorization result produced by the mailbox-action access check. Do not make undefined mean privileged execution.

**Validation:** Type checking should reject an ordinary caller that omits ownership; existing authorized background jobs should still work.

## F46

### P2: Optional cache persistence participates in the mutation success contract

Evidence: [apps/web/src/lib/gmail/inbox-query/actions.ts:135](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/actions.ts#L135), [apps/web/src/lib/gmail/inbox-query/actions.ts:285](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/actions.ts#L285), [apps/web/src/lib/gmail/inbox-query/actions.ts:302](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/actions.ts#L302), [apps/web/src/lib/query-persister.ts:159](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/query-persister.ts#L159).

Optimistic cache changes are persisted before entering try. If persistence rejects, the server mutation never runs and rollback is skipped. After a successful server mutation, another persistence failure enters the same catch and restores old data, making a committed action look undone. Rollback persistence can also replace the original server error. The storage adapter catches the initial setItem error but its eviction lookup/removal can still throw; the installed persister does not absorb synchronous adapter exceptions. This is the mutation consequence of F27's storage boundary problem.

**Correction:** Keep optional persistence failures separate from mutation failures, with one guarded storage adapter. Only roll back when the server operation failed, and preserve the original error even if persisting the rollback fails.

**Validation:** A throwing storage adapter must neither prevent the RPC nor undo a successful RPC. A server rejection must preserve its original user-facing error.

## F47

### P2: Whole-query rollback can erase mail received while an action is pending

Evidence: [apps/web/src/lib/gmail/inbox-query/query-cache.ts:89](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/query-cache.ts#L89), [apps/web/src/lib/gmail/inbox-query/query-cache.ts:110](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/query-cache.ts#L110), [apps/web/src/lib/gmail/inbox-query/actions.ts:214](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/actions.ts#L214), [apps/web/src/lib/gmail/inbox-query/actions.ts:273](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/gmail/inbox-query/actions.ts#L273).

An action snapshots every cached message query in the mailbox and restores those complete arrays on failure. The mailbox queue serializes local actions, but it does not serialize live-sync updates or query fetches. If sync adds a message while an RPC is pending and that RPC fails, restoring the old snapshot removes the newly received message from cache. The path does not cancel affected fetches or reconcile afterward.

**Correction:** Cancel overlapping query fetches before optimistic updates and avoid restoring unrelated entities. Apply an inverse change to affected messages, or invalidate and refetch when newer cache updates make the snapshot stale. Keep the solution at the existing query boundary.

**Validation:** Insert a new message into the cache between optimistic update and server rejection; rollback must retain that message.

## F48

### P2: Landing-page wrappers create a new React component on every render

Evidence: [apps/web/src/features/home/components/reveal.tsx:42](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/home/components/reveal.tsx#L42), [apps/web/src/features/home/components/reveal.tsx:71](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/home/components/reveal.tsx#L71), [vite.config.ts:277](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/vite.config.ts#L277).

Reveal and Entrance call m.create(as) inside their component bodies. Each render produces a new component type, so React can remount the child subtree and restart its animation or state. The lint override describes this as intentional because as is dynamic, but a dynamic tag does not require an unstable component identity.

**Correction:** Use stable Motion components for the small supported tag set, or move creation to a stable factory keyed by the element type. Remove the now-unnecessary compiler suppression for this file.

**Validation:** Rerender the wrapper with the same as value and confirm a stateful child remains mounted. Motion explicitly warns against this pattern: [official documentation](https://motion.dev/docs/react-motion-component).

## F49

### P2: BIMI caches expire values without bounding retained keys

Evidence: [packages/mail/src/bimi.ts:423](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/bimi.ts#L423), [packages/mail/src/bimi.ts:875](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/bimi.ts#L875), [packages/mail/src/bimi.ts:917](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/bimi.ts#L917), [packages/mail/src/sender-avatar.ts:48](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/mail/src/sender-avatar.ts#L48).

The resolver is reused at module scope. DNS and asset caches have no capacity limit; expiration removes an entry only when the same key is requested again. A long-lived process resolving many distinct senders therefore retains one-off expired entries indefinitely. A TTL alone does not bound this cache's memory.

**Correction:** Use a small bounded cache with expiration, or a supported platform cache appropriate to the runtime. Keep in-flight deduplication, but impose a capacity and remove expired entries without requiring those exact keys to recur.

**Validation:** Resolve more distinct keys than the configured capacity with an injected clock and confirm retained entries stay bounded.

## F50

### P2: Recording failures after startup disappear without an error contract

Evidence: [apps/web/src/lib/audio-recorder.ts:100](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-recorder.ts#L100), [apps/web/src/features/chat/components/chat-view.tsx:460](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L460), [apps/web/src/features/compose/components/compose-workspace.tsx:211](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-workspace.tsx#L211).

The MediaRecorder error listener stops tracks, clears the recorder, and flips isRecording, but never reports the error or exposes it to callers. start() has already resolved, so the caller's catch cannot observe this failure. The recording silently stops and the user loses the clip without a useful explanation.

**Correction:** Expose a recording error state or an onError callback from this existing hook and route it through the normal user-error/reporting contract. Preserve the existing track cleanup.

**Validation:** Dispatch a recorder error after a successful start; the caller should receive one failure and all tracks should stop.

## F51

### P3: Audio support detection omits the microphone acquisition API

Evidence: [apps/web/src/lib/audio-recorder.ts:68](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-recorder.ts#L68), [apps/web/src/lib/audio-recorder.ts:81](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-recorder.ts#L81).

isSupported checks MediaRecorder and MIME support, then start assumes navigator.mediaDevices.getUserMedia exists. Environments that expose the encoder but not microphone acquisition are advertised as supported and fail later with an unrelated exception.

**Correction:** Include mediaDevices/getUserMedia availability in the capability check. Permission denial still belongs in the normal start error path; availability does not imply permission.

**Validation:** A minimal browser fixture without mediaDevices should report unsupported before attempting to start.

## F52

### P3: Twenty-two conditional class expressions violate the required object syntax

Evidence: [apps/web/src/components/atmospheric-background.tsx:715](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/atmospheric-background.tsx#L715), [packages/ui/src/components/ui/dropdown-menu.tsx:59](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/dropdown-menu.tsx#L59), [packages/ui/src/components/ui/token-field.tsx:91](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ui/src/components/ui/token-field.tsx#L91).

The source contains 22 cn arguments using condition && className or ternaries instead of the object syntax required by AGENTS.md. They occur in nine app expressions and thirteen shared-UI expressions. This is a concrete consistency issue, not a runtime bug. Every occurrence is listed in occurrences.csv.

**Correction:** Use object entries for each conditional class while preserving the exact truth conditions. For a dynamically selected class, keep the computed class key explicit and avoid turning missing values into the string undefined.

**Validation:** Formatting/type/lint checks and a brief visual check of the affected states are sufficient; do not add snapshot tests for class strings.

## F53

### P3: useEntrance is an ordinary value factory named like a React hook

Evidence: [apps/web/src/features/home/components/reveal.tsx:14](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/home/components/reveal.tsx#L14).

useEntrance calls no hooks; it just returns a variants object from a boolean argument. The name falsely imposes hook expectations and obscures that this is ordinary presentation data. It also exports a helper used only within this file.

**Correction:** Rename it to describe the returned variants and keep it private, or use two module-level variants objects selected by the reduced-motion flag. Coordinate with the stable component correction in F48.

**Validation:** Type checking is sufficient; no new test is warranted.

## F54

### P3: Immediate values are needlessly wrapped in resolved promises

Evidence: [packages/gmail/src/service.ts:1088](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/gmail/src/service.ts#L1088), [packages/orpc/src/gmail-sync/service.ts:660](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-sync/service.ts#L660), [packages/orpc/src/mailbox/managed-grants.ts:421](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/mailbox/managed-grants.ts#L421), [packages/auth/src/index.ts:156](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/auth/src/index.ts#L156), [packages/orpc/src/connectors/runtime.ts:751](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/connectors/runtime.ts#L751).

Several Promise.all branches wrap ordinary arrays, null, or existing text in Promise.resolve. Async callbacks also return await Promise.resolve(object/token). These wrappers add syntax and artificial async steps without supplying I/O or error handling. The occurrence list distinguishes these cases from legitimate promise-tail initialization and synchronization.

**Correction:** Pass ordinary values directly to Promise.all, and return the value directly from an async callback when its contract requires a promise. Do not remove necessary await boundaries around try/catch/finally or genuine synchronization.

**Validation:** Type checking and existing tests are enough; do not test microtask counts for these cleanups.

## F55

### P2: Automatic-label usage reporting is copied across provider services

Evidence: [packages/orpc/src/gmail-sync/service.ts:232](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-sync/service.ts#L232), [packages/orpc/src/managed-mail/automation.ts:223](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/automation.ts#L223).

Two 59-line functions have the same normalized body, input shape, billing call, database table updates, and failure handling. These are the same accounting operation despite their Gmail/managed names. A billing correction must currently be applied twice and can easily drift.

**Correction:** Move this meaningful shared operation into the existing provider-neutral mail-automation area. Keep provider ingestion outside it. This is worthwhile consolidation of a business operation, unlike creating a generic helper for every repeated expression.

**Validation:** Existing provider tests should exercise the same shared reporting behavior; one focused failure/retry test at the shared boundary is sufficient.

## F56

### P3: Two settings screens independently define the same mailbox navigation contract

Evidence: [apps/web/src/features/settings/components/add-mailbox-settings-view.tsx:113](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/add-mailbox-settings-view.tsx#L113), [apps/web/src/features/settings/components/mailboxes-list-settings-view.tsx:143](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/settings/components/mailboxes-list-settings-view.tsx#L143).

Both navigateToMailbox functions repeat the same eleven-line search update, including mailboxView and tab. A settings URL change can update one screen and leave the other behind.

**Correction:** Define the settings destination/search construction once at the existing settings routing boundary, or pass the navigation callback from the parent that owns the route. Avoid adding a generic navigation service.

**Validation:** Check both selecting an existing mailbox and creating a mailbox land on its detail screen. No implementation snapshot is needed.

## F57

### P3: The Durable Object duplicates the shared Worker error response

Evidence: [packages/cloudflare/src/gmail-live-sync-mailbox.ts:10](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/src/gmail-live-sync-mailbox.ts#L10), [packages/cloudflare/src/worker-utils.ts:311](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/src/worker-utils.ts#L311).

requestErrorResponse is copied verbatim, including classification, unexpected-error reporting, and the response envelope. The Durable Object already imports worker-utils, so this duplication is not preserving an otherwise independent deployment boundary.

**Correction:** Import the existing exported implementation. If the relevant bundle check reveals a real graph concern, move just the small shared error boundary to a focused module rather than retaining two copies.

**Validation:** Run the Cloudflare boundary/bundle checks when implementing this import change.

## F58

### P3: QueryClient ownership uses a performance cache and redundant default objects

Evidence: [apps/web/src/components/providers.tsx:38](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/providers.tsx#L38), [apps/web/src/components/providers.tsx:50](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/components/providers.tsx#L50).

A stateful QueryClient is owned through useMemo, while new MutationCache() and new QueryCache() merely repeat its defaults without options. The extra constructors/imports obscure the few settings that actually matter. React documents useMemo as a performance optimization whose cached value may be discarded; a lazy state initializer expresses client ownership more directly. This is separate from F28's session invalidation bug.

**Correction:** Use lazy state for the client lifetime and omit unconfigured cache constructors. Preserve the client instance across ordinary rerenders; do not apply a blanket remove-memo recommendation that constructs a fresh client every render.

**Validation:** Confirm the same client survives rerenders and existing session/cache behavior remains intact. See [official documentation](https://react.dev/reference/react/useMemo).

## F59

### P3: Window activity has different initial and subsequent definitions

Evidence: [apps/web/src/features/mailbox/components/mailbox-workspace/use-mailbox-messages.ts:171](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/mailbox/components/mailbox-workspace/use-mailbox-messages.ts#L171), [apps/web/src/features/mailbox/components/mailbox-workspace/use-mailbox-messages.ts:180](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/mailbox/components/mailbox-workspace/use-mailbox-messages.ts#L180).

The initial state checks document visibility only; later events require visibility and document.hasFocus(). Mounting a visible tab in an unfocused browser window therefore starts as active until another focus/visibility event arrives. The effect never reconciles its initial value.

**Correction:** Use the same predicate for initialization and updates, and reconcile once when installing the listeners. Decide explicitly whether window focus is needed in addition to TanStack Query's visibility behavior; do not silently substitute different semantics.

**Validation:** Mount while visible but unfocused and confirm the initial live-sync activity decision matches later updates.

## F60

### P3: A bounded stream reader uses async recursion for an ordinary loop

Evidence: [packages/cloudflare/src/worker-utils.ts:144](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/cloudflare/src/worker-utils.ts#L144).

readChunks recursively awaits itself for every incoming chunk and widens a typed Request body chunk to unknown before checking Uint8Array. The recursion retains a chain of promises until the body ends. The corresponding chat reader already expresses the same ordered work with a while loop and a justified await-in-loop suppression.

**Correction:** Use a straightforward serial loop with the existing byte limit, cancellation, and finally/releaseLock. Keep a narrow lint suppression if required; do not build control-flow machinery to avoid one loop warning.

**Validation:** Use existing empty, over-limit, and multi-chunk request tests; no test should assert whether a loop or recursion is used.

## F61

### P3: The two web JSON body readers have different resource and decoding rules

Evidence: [apps/web/src/routes/api/v1/send.ts:82](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/routes/api/v1/send.ts#L82), [apps/web/src/routes/api/v1/send.ts:97](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/routes/api/v1/send.ts#L97), [apps/web/src/routes/api/v1/send.ts:125](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/routes/api/v1/send.ts#L125), [apps/web/src/lib/limited-json-request.server.ts:28](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/limited-json-request.server.ts#L28), [apps/web/src/lib/limited-json-request.server.ts:51](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/limited-json-request.server.ts#L51).

The send endpoint has its own bounded reader, never releases its reader lock, copies all chunks into a second byte array, and silently replaces invalid UTF-8. The chat helper releases the lock in finally and rejects invalid UTF-8. The helper itself hardcodes chat wording despite its general name. This makes the same transport concern behave differently across adjacent endpoints.

**Correction:** Use one application-level bounded JSON reader with typed size/encoding/parse errors and endpoint-owned copy. Preserve each endpoint's limit and public status contract. Do not import the Worker deployment graph into app code just to share a few transport operations.

**Validation:** Check limits at a chunk boundary, reader failure, invalid UTF-8, and ordinary JSON. Existing tests can cover the shared boundary.

## F62

### P3: Strict event types are followed by impossible undefined checks

Evidence: [packages/orpc/src/gmail-sync/service.ts:248](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/gmail-sync/service.ts#L248), [packages/orpc/src/managed-mail/automation.ts:239](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/managed-mail/automation.ts#L239).

The usage event explicitly declares promptTokens, completionTokens, and costUsd as number | null, yet both copies test each for null and undefined. The redundant branches imply an uncertain external shape even though this is an internal typed contract.

**Correction:** Remove impossible undefined branches when consolidating the reporting function. If an actual untrusted boundary can omit these fields, validate it there and represent that fact in the boundary type instead of scattering defensive checks downstream.

**Validation:** Type checking and the existing usage tests are enough.

## F63

### P2: Chat unconditionally transcodes browser audio through a handwritten WAV encoder

Evidence: [apps/web/src/lib/audio-transcription.ts:50](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-transcription.ts#L50), [apps/web/src/lib/audio-transcription.ts:106](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-transcription.ts#L106), [apps/web/src/features/chat/components/chat-view.tsx:484](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L484), [apps/web/src/features/compose/components/compose-workspace.tsx:236](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-workspace.tsx#L236).

Every non-WAV chat recording is decoded through AudioContext, mixed to mono, encoded by custom PCM/WAV code, and base64-encoded again. The recorder produces WebM, the server schema accepts WebM, and compose already sends that original format. This increases memory, payload size, latency, and browser failure modes while maintaining two different paths for the same transcription endpoint. Current provider documentation lists WebM as an accepted format; a special requirement of the configured model was not verified against live credentials.

**Correction:** Verify one dedicated test clip against the configured development model, then send the original supported format by default. Retain conversion only for a demonstrated unsupported format/provider case. Share the preparation contract between chat and compose rather than maintaining an unconditional custom encoder.

**Validation:** Verify the configured model accepts the recorder output before removing the fallback. Provider contract: [official documentation](https://openrouter.ai/docs/guides/overview/multimodal/stt). WAV byte-layout tests are valid format tests while the encoder remains; they are not change-detector tests.

## F64

### P3: Compose omits the transcription limits that chat checks before upload

Evidence: [apps/web/src/features/chat/components/chat-view.tsx:477](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L477), [apps/web/src/features/chat/components/chat-view.tsx:490](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L490), [apps/web/src/features/compose/components/compose-workspace.tsx:236](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/compose/components/compose-workspace.tsx#L236), [packages/orpc/src/routers/chat.ts:20](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/chat.ts#L20).

Chat checks the 60-second and base64-size limits before calling the server. Compose sends the recording without either check and relies on schema rejection after upload. Users can record a clip the product will reject, and the two interfaces have different preparation and feedback behavior. Server validation remains present; this is not an unlimited server input claim.

**Correction:** Share the small preparation/limit contract between the two callers and stop or visibly limit recording at the supported duration. Keep server validation authoritative.

**Validation:** An over-limit compose recording should give the same useful local feedback as chat and should not upload.

## F65

### P2: Transcription error classification depends on English message prefixes

Evidence: [apps/web/src/features/chat/components/chat-view.tsx:506](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/features/chat/components/chat-view.tsx#L506), [packages/orpc/src/routers/chat.ts:192](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/orpc/src/routers/chat.ts#L192), [packages/ai/src/openrouter-transcription.ts:16](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/packages/ai/src/openrouter-transcription.ts#L16).

Both server and client decide whether an error is displayable by matching strings such as Transcription or We could not transcribe. A wording change changes error behavior. Chat also bypasses toastError, so an expected credit or authorization error that does not match these prefixes becomes a generic transcription failure. This is a concrete extra occurrence of the error-contract problem in F26.

**Correction:** Classify provider/domain failures using typed error codes at the server boundary and use toastError in the caller. Keep expected user messages verbatim and report unexpected failures without exposing internal text.

**Validation:** An exhausted-credit error keeps its server message; an unexpected provider error is reported and shown generically, independent of its wording.

## F66

### P3: The recording value type is declared twice with the same fields

Evidence: [apps/web/src/lib/audio-recorder.ts:3](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-recorder.ts#L3), [apps/web/src/lib/audio-transcription.ts:6](https://github.com/quieter-email/quieter/blob/78621b3454b4fc304f41c6040c5c72577d2c0163/apps/web/src/lib/audio-transcription.ts#L6).

AudioRecorderRecording and BrowserAudioRecording separately declare base64, blob, durationMs, and mimeType. Structural typing hides any drift until a field is used, and names suggest two representations even though normalization accepts and returns this same shape.

**Correction:** Own the recording value type once in the audio domain and import it in both modules. Keep any future native-versus-normalized distinction explicit only if their contracts actually differ.

**Validation:** Type checking is sufficient; no new runtime test is warranted.
