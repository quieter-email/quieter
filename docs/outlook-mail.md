# Outlook mail contract

This is the implementation contract for QUIETER-206, reviewed against main `935978cd2abd845abbe543da90d6ad2e593511bf` on 2026-11-16. It adds no connected mailbox or production handler. The fixture below exercises a reference model, not Microsoft authentication, Graph requests, or Quieter's deployed services. QUIETER-214, QUIETER-219, and QUIETER-222 retain their blockers and capacity HOLD.

## Supported accounts and runtime

The MVP supports the signed-in account's own primary Exchange Online mailbox for work or school accounts and Outlook.com personal accounts in Microsoft's global cloud. Guest identities without a primary mailbox, shared or delegated mailboxes, groups, on-premises Exchange, archive mailboxes, sovereign clouds, IMAP, and Microsoft Calendar are outside this contract. Connecting a tenant identity does not prove that the account has a usable Exchange mailbox. Verify `/me` and a bounded mail-folder read before recording a connected mailbox. [Microsoft's mail overview](https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview) and [delegated notification restrictions](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview) define the provider boundary. Both account classes need their own live acceptance.

Select Graph v1.0 REST, bounded `fetch`, and server-side authorization code flow with S256 PKCE. Keep provider wire schemas and normalization in a separate `packages/outlook` package. Keep database access, acting-user authorization, credential rotation, and application enrichment in `packages/orpc`. App code continues to use `@quieter/orpc` and provider-neutral mail contracts.

| Auth option | Decision |
| --- | --- |
| Existing server-side fetch, PKCE, and encrypted credential patterns, with JOSE validation for OIDC | Selected for the existing Worker callback and server package boundaries. Reuse the established protections; keep a separate mail registration, state table, and credentials. |
| MSAL Node and Graph JavaScript SDK | Microsoft recommends supported auth libraries. Neither is installed or pinned here. The inspected MSAL Node source requires Node and is not evidence of Worker compatibility. A new Node token-broker service is unnecessary for this MVP. |
| Browser token cache or reuse of Calendar/identity tokens | Rejected because tokens, refresh, and credential ownership belong on the server and consent must be separate. |

This is an explicit runtime tradeoff from Microsoft's [MSAL recommendation](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow). Use `jose` as a direct server dependency when implementation is enabled, rather than writing signature verification. The lockfile already contains `jose` 6.2.12 transitively; [its runtime documentation](https://github.com/panva/jose) includes Workers. No dependency is added by this planning unit. QUIETER-214 must verify the actual resolved dependency, Worker bundle, and OAuth protocol cases before exposing connection UI. Compatibility is a required implementation gate.

Observed tools are Node 26.11.1 and global Vite+ 1.3.0. The repository pins Node 26.11.1, Vite+ 1.1.0, and SST 4.17.2 in its version files and lockfile. This worktree has no installed project dependencies. `devproxy` and `devtunnel` are absent from PATH. No provider CLI or SDK runtime was executed or installed.

## Existing path that Outlook must preserve

The canonical UI inputs are `MessageListItem`, `ListMessagesPageResult`, `ThreadMessagesResult`, and `MailboxSyncDelta` in [`packages/mail/src/messages.ts`](../packages/mail/src/messages.ts). `MailThreadSummary` in `data-plane.ts` is insufficient on its own.

| Stage | Working source and required integration |
| --- | --- |
| Authorization | `mailbox/service.ts`, `assertAccessibleMailbox`, accepts an owner-scoped Gmail mailbox or explicit managed grants. `gmail-mailbox-access.ts` joins mailbox, owner, and credential. Outlook gets the same private-owner boundary. |
| List | `mail/queries.ts`, `listThreads`, selects authorized managed reads or Gmail reads, then combines history with `contentRevision` and importance/unsubscribe enrichment. Outlook must enter explicit dispatch and run the complete enrichment path. |
| Thread | `gmail/src/service.ts`, `getThreadWithDetails`, and `managed-mail/messages/service.ts`, `getManagedThread`, provide ordered messages, draft identity, thread aggregates, and metadata. Outlook must supply these canonical results. |
| Attachment | `mail/queries.ts`, `getAttachment`, authorizes before dispatch. `managed-mail/messages/attachments.ts` verifies mailbox, message, and attachment together. Keep the existing `{ attachmentId, file: File, size }` result. |
| Consumer | `packages/app/src/lib/mail/inbox-query/sync.ts` and `thread-query.ts` call the neutral RPCs. Their keys include mailbox ID. `message-list.tsx`, `message-row.tsx`, and `message-body.tsx` consume aggregate counts, avatars, body, and CID attachment metadata. |
| Existing Microsoft auth | `connectors/oauth-provider.ts` requests Calendar or OneDrive scopes. `connectors/runtime.ts` encrypts credentials and serializes refresh with a row lock. `calendar/microsoft.ts` selects the Calendar provider explicitly. None grants mail support. |

Paths above are relative to `packages/orpc/src` unless another package is named. Schema currently permits only `gmail` and `managed`, including ownership checks. Several read branches currently mean "managed, otherwise Gmail". Extending the provider union alone would select Gmail accidentally. QUIETER-214 must update authorization and dispatch atomically with the new provider's exposure.

The parity fixture for actual reads must include reply/reference headers, `receivedAt`, body HTML/text, draft ID/revision/anchor, attachments and inline images, thread label union, message/attachment counts and names, sender avatar URLs, OTP extraction, importance, and unsubscribe targets/status. Derive these using the existing MIME/content, avatar, importance, and unsubscribe services. Do not return only a similarly typed provider summary or fill missing metadata in UI consumers. Preserve loaded bodies during list refresh, as `inbox-query/data.ts` already does. Existing unsupported source metadata remains absent; never invent delivery, tracking, or unsubscribe success.

## Consent, ownership, and credential lifecycle

Use a separate Entra application registration for Quieter mail, and a separate development registration from production. Its web callback is the exact configured origin plus `/api/outlook/callback`. Do not append mail scopes to `MICROSOFT_CLIENT_ID`, Calendar, OneDrive, or Quieter identity sign-in. Only an authenticated Quieter session may start or finish a connection. The Microsoft ID token identifies the connected account; it does not sign a user into Quieter.

| Phase | Delegated permissions requested |
| --- | --- |
| QUIETER-214 reads | `openid profile offline_access User.Read Mail.Read` |
| QUIETER-219 opt-in mutations | Keep identity/refresh scopes and request `User.Read Mail.ReadWrite Mail.Send` through the mail registration. Reconsent is explicit. |
| Category taxonomy management | Outside MVP. Do not request `MailboxSettings.ReadWrite` just to display or assign existing message categories. |

`Mail.ReadBasic` cannot supply message bodies and attachments. `Mail.ReadWrite` does not grant sending. No application permissions, shared-mail permissions, directory-wide access, or automatic consent upgrades are allowed. [The permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) defines these boundaries. Tenant consent policies can still require an admin, even when a delegated permission is user-consentable.

1. Start only after organization membership, private ownership, and the approved external-mailbox capacity policy pass. Persist a short-lived, single-use OAuth attempt tied to user, organization, optional existing mailbox, exact redirect, requested capability phase, and credential generation. Store a state hash, encrypted verifier, and OIDC nonce. Return only a random opaque state value.
2. Require the same Quieter session on callback. Atomically claim the attempt before token exchange by setting `consumedAt` and a random `claimId` only while both are absent. Retain that single-use receipt until the final admission transaction locks and rechecks its actor, session, claim and expiry, then deletes it with the connection write. Reject expiry, replay, wrong user, wrong purpose, changed redirect, or stale reconnect generation. A failed exchange starts a new attempt.
3. Validate the ID token's signature, algorithm, issuer/tenant relationship, audience, nonce, and lifetime using fixed Microsoft discovery/JWKS origins and JOSE. Do not fetch a token-supplied key URL. Use the verified issuer and subject plus `/me` account ID for reconnect identity. Email and UPN are display values, not authorization keys. Keep Graph access tokens opaque.
4. Validate token-response scopes and expiry, require refresh capability, identify `/me`, and verify mail access. Reconnect must match the original account and mailbox. Never replace another owner's mailbox or infer access from an email.
5. Store access/refresh tokens encrypted with authenticated encryption and the existing versioned credential-key pattern. Credentials belong to one user and mailbox. Use SST-linked `OutlookMailClientId`, `OutlookMailClientSecret`, and `OutlookMailTokenEncryptionKey`; `@quieter/env` owns their reads. Keys, tokens, verifiers, and cursor URLs never enter logs, client caches, or analytics.
6. Serialize token rotation per credential with the existing transaction/row-lock pattern. Preserve an omitted replacement refresh token, update returned scopes, and check generation before committing. Retry a rejected access token once after a successful refresh. Permanent grant failure, missing scope, or revoked access sets `needs_reconnect` and suspends provider work. Transient failures retain encrypted credentials and schedule bounded retry.
7. Disconnect first cancels the owner's pending and claimed attempts for that mailbox and initial connections, then increments generation and cancels queued provider work. Callback admission acquires its retained receipt before organization, mailbox and credential locks, matching disconnect's receipt-first order. A callback whose receipt was cancelled cannot recreate a disconnected mailbox. Delete subscriptions best-effort under the old credential when the notification contract exists, remove usable local tokens, and apply the existing mailbox deletion/retention policy. An in-flight page from an older generation cannot recreate state. Explain how to revoke the application's consent in Microsoft's account portal. Local disconnect and Quieter sign-out do not imply tenant-wide grant revocation.

These are requirements for the future implementation, not results of the fixture. See Microsoft's [OIDC flow](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols-oidc) and [opaque access-token guidance](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens). Existing managed grants and personal AI context remain separate. Load assistant context through `loadAiAgentContext`; never derive mail access from Calendar access.

## Canonical identity, folders, and sync

Every persisted key, query, mutation, attachment, cache entry, timer, draft, and job includes Quieter `mailboxId`. Server work also carries acting user or a server-owned credential identity and the credential generation. Never authorize a caller by a provider ID or provider cursor alone.

Message identity is `(mailboxId, immutableMessageId)`. Conversation identity is `(mailboxId, conversationId)`, preserving exact case and opaque bytes. Attachment identity includes mailbox and parent message. Request `Prefer: IdType="ImmutableId"` on reads, delta requests, mutations, and subscription creation. IDs survive primary-mailbox folder moves, but not archive-mailbox moves or export/reimport. Folder IDs have their own stability rules. [Microsoft's immutable-ID contract](https://learn.microsoft.com/en-us/graph/outlook-immutable-id) also documents correlation of a sent draft with its Sent Items copy.

Persist folder membership separately from the message's cached content. Map well-known Inbox, Sent Items, Drafts, Junk Email, Deleted Items, and Archive folders by provider IDs rather than localized names. Discover child folders recursively, including hidden folders where supported, and retain folder delta state. User categories remain a separate namespaced label mapping, with exact provider names retained for round trips. Flags and `importance` are distinct.

Initial hydration starts with folder discovery, then one unfiltered metadata delta stream per eligible folder, newest messages first. Bound each work slice, for example to five pages of 50 messages, with one in-flight request per mailbox. These are tuning choices, not service limits or tests to lock. Resume subsequent slices until the initial round completes. Fetch bodies on demand and expose incomplete metadata coverage while backfill continues. Do not mistake a filtered recent window or an unfinished page chain for a complete folder. Hydrate opened conversations across folders, following all pages. If a complete thread exceeds the request budget, return a recoverable error rather than a partial result that claims to be complete.

Each page validates all wire data and its continuation URL before committing message updates, folder memberships, page checkpoint, and app content revision in one transaction. A page failure leaves the preceding checkpoint usable. Do not advance the stable round cursor until `@odata.deltaLink` arrives. Persist an intermediate `@odata.nextLink` to resume a partial round after restart. Follow the complete opaque URL; do not rebuild `$skip`, alter its filter, decode tokens, or put it in a public pagination token.

Restrict provider continuation URLs to HTTPS `graph.microsoft.com`, no credentials, fragment, or non-default port, and the same folder's message-delta stream. Accept the slash and OData predicate path forms shown in Microsoft's examples, including case differences in API segment names, while comparing decoded folder IDs exactly. Preserve the original continuation URL for the request. Do not accept another mailbox, folder, or Graph operation merely because the host matches. [Microsoft's incremental examples](https://learn.microsoft.com/en-us/graph/delta-query-messages) include `me/mailfolders('{id}')`. Subscriptions use a separate allowlist for `/v1.0/subscriptions`. Store client pagination as a server-owned handle bound to mailbox, category, search, generation, and expiry. A handle from another mailbox or query is rejected.

Delta can contain repeated updates and entries outside the initial time filter. Apply all relevant changes, including read state. Treat `changeKey` and ETags as opaque, not sortable sequence numbers. Serialize rounds, re-read current resource state when ambiguous, and reconcile dirty folders. A folder tombstone removes membership in that folder; it does not prove global message deletion. Keep other-folder membership and cached content until authoritative reconciliation or bounded retention establishes deletion. Cached content is still owner-private. Duplicate or delayed notifications only mark a mailbox dirty. [Message delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0) is folder-scoped and does not support `$search`.

On an expired/invalid delta cursor, start a new bounded folder epoch without clearing readable cached content first. Publish removals only after the new epoch completes for its declared coverage. A partial recent window cannot prove that older messages were deleted. Folder changes, offline recovery, periodic reconciliation, and a new reply must update canonical thread aggregates and the app's `contentRevision`. Map provider errors into the existing `MailErrorCode` contract and report unexpected failures to Sentry without content.

## Reads, search, and attachments

Lists and threads return existing canonical shapes after source normalization and enrichment. Sort conversations deterministically by latest message time with a stable ID tie-breaker. Counts distinguish the loaded hydration window from provider folder totals. Do not label a partial local count as a full-mailbox count. Never expose provider continuation URLs as `historyId`; use a mailbox-bound revision token whose generation is checked server-side.

Retain the provider-returned `webLink` with the scoped message record. The current `MessageListItem` has no provider source-URL field. Before exposing Outlook source links, request a neutral optional source descriptor from the coordinator and carry it through app and assistant results. Validate its HTTPS origin against the account's approved Outlook host; never assemble a Gmail URL from an Outlook ID. [The message resource](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0) defines `webLink` as the Outlook-on-the-web message link. Do not log its private parameters or use it as a fetch target.

Use Graph message `$search` for mailbox text search, with a supported structured subset translated at the server boundary. Preserve the existing parser's meaning for sender, recipient, subject, date, read state, attachment, and label filters only where the complete expression can be represented. Reject unsupported operators with a user-facing capability message rather than silently dropping them or sending Gmail syntax unchanged. Do not evaluate an omitted filter over only a partial page. Restrict search to the authorized primary mailbox. Local semantic search uses the existing consent/index pipeline and states its coverage. [Provider text search](https://learn.microsoft.com/en-us/graph/search-query-parameter) is bounded to 1,000 results. Surface truncation and never invent another page.

Attachment metadata distinguishes file, item, reference, and inline attachments. Do not infer absence of inline content from `hasAttachments` alone. Preserve CID mapping. Fetch bytes on demand only after verifying the complete scoped tuple; apply the existing application MIME, size, and download protections. Support file attachments and attached-message MIME. Reference attachments are external links, not authenticated arbitrary fetch targets, and cannot masquerade as downloaded files. Unsupported content gets an explicit capability error. [Attachment reads](https://learn.microsoft.com/en-us/graph/api/message-list-attachments?view=graph-rest-1.0) require full mail read permission.

## Capabilities and later write contract

QUIETER-214 is read-only. All mutation booleans stay false until QUIETER-219's shared workflow dependencies and provider checks pass. The following table defines the intended supported write subset, not current availability.

| Shared behavior | Outlook mapping and limit |
| --- | --- |
| Inbox, unread, sent, drafts, spam, trash | Well-known folder membership plus `isRead` and `isDraft`; retain the canonical `UNREAD` label agreement. |
| Important | Preserve app importance enrichment and canonical thread aggregates. Provider `importance` is an input, not a replacement for the current importance contract. |
| Labels/categories | Read existing message categories. Assign/remove existing categories with mail-write consent in 219. Taxonomy CRUD is unsupported. Split assignment capability from `canManageLabels` before exposing that action; do not make one boolean promise taxonomy operations. |
| Mark read, spam/trash/restore | Apply to resolved message targets in the authorized mailbox. Preserve original folder IDs for reversible operations. Moving to Junk does not claim a separate spam-report action succeeded. Permanent deletion remains disabled. |
| Done | Consume 197's shared reversible command/journal and original-folder capture. Move eligible Inbox messages to primary-mailbox Archive. New replies reopen through the shared rule. Do not substitute a provider flag. |
| Snooze | Consume 207's durable timer and ownership contract. A Quieter-owned folder may hold messages; return is a server-owned Inbox mutation. This is not Outlook's native Snooze feature. |
| Draft/reply/forward | Use provider draft creation and reply/forward draft APIs, preserve server revision and source anchors, and require explicit conflict resolution after a concurrent upstream edit. |
| Send, scheduled send, Undo Send | Reuse 198's approved durable send receipt and dispatch cutoff. No provider dispatch before the cutoff. No independent timer, billing, suppression, or resend coordinator. |
| Identity/signature | Use the verified mailbox address and the existing app signature preference. No arbitrary From, alias send-as, delegated send, or automatic signature retrieval. `canSetSenderName` remains false. |

Draft-first sends persist the immutable draft ID and a mailbox-scoped logical send identity before dispatch. Correlate a lost draft-creation response with a single-value extended property carrying that send identity. Resolve ambiguous creation before another POST. Provider dispatch is at most one automatic attempt per authorized receipt. A timeout, lost response, or `202` never means delivered. Reconcile the immutable draft ID against Sent Items and the dispatch journal; temporary absence does not authorize a resend. Leave unresolved outcomes pending for reconciliation or an explicit recovery action. Retrying a local request returns the existing receipt. [Send acceptance](https://learn.microsoft.com/en-us/graph/api/user-sendmail?view=graph-rest-1.0) does not establish delivery. Validate the extended-property correlation path in a dedicated account before enabling 219 writes.

Keep current composer MIME/attachment limits. Files below 3 MB use the small attachment API; files at or above that boundary need a resumable upload session within both application and account limits. A provider allowance is not an app limit increase. Upload URLs are short-lived secrets, used only with the upload contract's required authentication behavior, and never accepted from clients. [Large-attachment documentation](https://learn.microsoft.com/en-us/graph/outlook-large-attachments) describes the separate session path. No fixture here proves upload or send behavior.

## Background freshness and recovery

QUIETER-222 creates one server-owned, basic message subscription per mailbox and environment, without message resource data. Use the immutable-ID preference, a random encrypted `clientState`, generation, provider subscription ID, expiry, and a lifecycle callback. Match every notification against the stored mailbox, subscription, resource, generation, and `clientState` before scheduling work. Notifications are hints, never authoritative mutations or permission grants.

Validation callbacks return the decoded validation token as plain text within the provider deadline. Actual notifications durably enqueue dirty work and return promptly; do not acknowledge before durable scheduling. Handle mixed batches independently, reject unknown subscriptions, and bound payload size. Keep secrets and resource paths out of logs. Plain notification validation is distinct from JWT validation required by rich notifications, which are not selected. [Microsoft's webhook contract](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks) requires a public HTTPS endpoint and timely acknowledgements.

Renew before the returned expiry, with jitter and a server-owned lease. Do not hardcode the maximum lifetime as the renewal schedule. Reauthorization, removed subscription, missed notifications, expiry, and a renewal conflict trigger reconciliation and controlled recreation. Honor `Retry-After` for throttling, bound retries with backoff, and serialize per mailbox. No batch or background loop gets a separate concurrency budget that bypasses the mailbox budget. Keep caches usable offline, surface stale or reconnect state, and run delta on reconnect even if notifications appeared healthy. Recheck shared Done, Snooze, and send recovery after each confirmed canonical update.

## Development and release gates

Run the safe reference fixture without dependencies or a network connection:

```sh
vp exec node scripts/verify-outlook-mail-contract.ts
```

It exercises callback ownership/replay rejection, reconnect suspension, opaque continuations, page checkpoint failure, folder membership, duplicate replay, mailbox isolation, and stale-generation rejection. The dedicated CI workflow runs the same command. It does not load credentials, start servers, call Graph, verify JWT signatures, or test production database constraints. Its cases must be migrated into actual adapter and authorization tests when 214 is implemented.

For a later live development run:

1. Record a dedicated personal test account and a dedicated Exchange Online account, separate development app registration, consent owner, and exclusive mailbox/subscription mutation ownership in the lane receipt. A developer sandbox is conditional on eligibility, not guaranteed free infrastructure. Use an existing approved account or ask for an account decision before any paid resource. The [developer-program requirements](https://learn.microsoft.com/en-us/office/developer-program/microsoft-365-developer-program) define eligibility.
2. Have the coordinator provision development SST secrets and links, exact web redirect URI, and protected webhook bindings. Run `vp run env:doctor` after approved local configuration changes. Do not reuse production or Calendar credentials. Keep Sentry/PostHog disabled locally by default and log only safe error codes, counts, and non-sensitive operation diagnostics.
3. Reserve a loopback port and record the owned PID. Use the existing app/local Worker workflow and approved `quieter_dev` database. No destructive reset, schema application, new persistent database, or paid branch is implicit.
4. Prefer Microsoft's [Dev Proxy mocks](https://learn.microsoft.com/en-us/microsoft-cloud/dev/dev-proxy/how-to/mock-responses) for HTTP failure injection when that tool is approved and installed. Verify the installed version and proxy behavior first. It does not provide OAuth consent or an Exchange emulator. The committed fixture needs neither proxy interception nor a trusted local certificate.
5. For actual webhook testing, Microsoft's [dev tunnels CLI](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/cli-commands) can expose an owned callback port, for example `devtunnel host -p <port> --allow-anonymous`. Restrict the exposed listener to the callback route and validate notifications. Do not expose the full authenticated app or admin routes through an anonymous tunnel. Record the exact callback and expiry, and stop only the lane's own processes after verification.

| Gate | Owner and required evidence | Status for this unit |
| --- | --- | --- |
| Synthetic auth/read contract | I, runnable fixture and fresh source review | Covered by this PR's checks. |
| Actual SDK/OIDC and Worker behavior | I with coordinator-owned bindings, 214 bundle and signature/issuer/nonce tests | Unrun. No installed provider runtime is claimed. |
| App registration and tenant consent | Human account/tenant owner, separate dev registration and exact redirects | Unverified, no credentials inspected or consent requested. |
| Personal and work/school read acceptance | I on dedicated accounts, page/open/search, attachment, upstream change, revoke/reconnect, two-owner isolation | Unrun; required before 214 is complete. |
| Shared schema and registration | Coordinator, additive reviewed migrations, explicit authorization/dispatch, quota policy and exports | Proposal below only. No shared file is edited. |
| Done, Snooze, Undo Send | A/B approved 197, 207, 198 pins and shared service contracts | Existing blockers retained for 219. |
| Real write/recovery acceptance | I on exclusively owned test accounts, duplicates, uncertain dispatch, upload, identity and draft conflicts | Unrun; required before 219 is complete. |
| Notifications and public readiness | I/coordinator, public callback, duplicate/loss/renew/revoke recovery, protected rollout and provider consent review | Unrun; required before 222 is complete. |

No gate is satisfied by building an artifact or by this planning PR merging. Microsoft publisher verification and tenant consent policy must be evaluated against the final production registration by its owner. Do not promise universal user consent, production approval, or an unrun release.

## Reserved integration proposal

After this contract is reviewed and the coordinator enables 214, request one coordinator-owned expand/contract unit with the following exact semantic changes. The proposal is not authorization to edit or apply shared schema now.

- Add persisted provider `outlook` as a private `ownerUserId` mailbox with the same ownership isolation as Gmail. Update all provider and ownership checks. Require an explicit provider switch before exposure, including authorization, listing, counts, capacity, deletion, queries, and background work. Preserve managed grants.
- Add Outlook-owned OAuth attempts and encrypted credential rows. Each credential has mailbox/user ownership, verified issuer/subject and Graph account ID, scopes, expiry, generation, and connected/reconnect/disconnected state. Add unique owner/account and mailbox credential constraints plus ownership foreign keys.
- Add mailbox-scoped message identity, folder membership, folder/round checkpoints, and reconciliation epochs. Keep source content/enrichment in the established canonical ingestion path. Bound large page cursors and encrypted secrets at rest. Subscription state belongs to 222 and dispatch bindings reuse the approved 198 contract rather than a competing send schema.
- Add `@quieter/env` bindings for the three named Outlook SST Secrets. Register isolated mail callback/RPC modules without changing Calendar scopes. I supplies leaf package exports and adapters. A owns mailbox parent mounts, B compose mounts, and G assistant composition. Request their narrow mounts against approved pins.
- Add a neutral optional source descriptor to canonical message results before exposing Outlook links. I supplies the validated provider `webLink`, and A/G own the UI and assistant mounts. Preserve existing source enrichment for other providers rather than inventing links in each consumer.
- Before 219 exposes category assignment, add a neutral assignment capability separate from taxonomy management and migrate existing callers together. Preserve current Gmail and managed behavior. Do not grant new tenant settings permission to avoid making this distinction.
- Before 222, supply deployment-safe basic notification and renewal entry points with request-local database clients. Run boundary and handler bundle checks under the coordinator's verification allocation. Apply no production migration or deploy.

214 owns actual canonical reads and isolation verification. 219 owns writes and workflow joins. 222 owns background and release acceptance. No new duplicate issues or removed blockers are needed to represent these unrun stages.

## Provider adapter development

`packages/outlook` supplies separate server-side OAuth and read-only Graph leaf modules. OAuth configuration is injected by its server caller. The adapter does not read identity or Calendar credentials. Canonical normalization reuses the mail package's content, unsubscribe, OTP, avatar, attachment and draft-anchor helpers, including the optional validated external source descriptor.

Run its synthetic protocol and normalization cases with `vp test packages/outlook/tests --maxWorkers=1`. Run its standalone type check with `vp exec tsc --noEmit -p packages/outlook/tsconfig.json`. These commands do not connect an account. The tests replace HTTP at the provider boundary.

The provider compatibility unit keeps database admission closed. Application write guards reject unsupported providers after mailbox authorization and before provider, journal or draft effects. Storage, root registration, complete source enrichment, real consent and dedicated-account read/revocation acceptance remain separate required joins. Neither these fixtures nor the adapter package enables an Outlook mailbox by itself.
