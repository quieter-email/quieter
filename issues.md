# Prioritized issue register

Priority reflects user impact, security and privacy exposure, data integrity, billing correctness, production reliability, and the likelihood that later work depends on the fix.

- **Resolved:** issues **1–20, 209, 222, 226, 231, 247, 250, 254, 276, 286, and 288** have been addressed.
- **P1 — High:** serious correctness, isolation, durability, privacy, or operational risks that should be addressed before scaling the affected feature. Issues **21–27, 38–39, 43–52, 59–61, 63–69, 73–81, 83–90, 94–96, 100–102, 108, 111–114, 118–124, 127–130, 137–150, 152–161, 164–167, 171–175, 188, 202, 208, 214–217, 220–221, 223–225, 227–230, 246, 249, 251–253, 266–275, 278–284, 294–295**.
- **P2 — Medium:** important resilience, scalability, maintainability, contract, and test-coverage work. All unresolved issues not listed under P1 or P3.
- **P3 — Low:** localized cleanup, optimization, or future-proofing with limited near-term user impact. Issues **28–30, 33–35, 40, 53–54, 71–72, 82, 92–93, 97–99, 103–107, 109–110, 115–117, 131–136, 162–163, 168–170, 176, 179–186, 193–200, 203–207, 210–213, 218–219, 232–245, 248, 255–265, 277, 285, 287, 289–293**.

Within each domain below, issues remain in their original order so references and related findings stay together.

## Resolved P0 issues

Resolved on June 20, 2026 by the P0 reliability and security remediation change set, including its database migration and billing regression tests.

1. **Global mutation retries can duplicate side effects.** The shared Query client retries mutations on network and 5xx failures. That is unsafe for sending mail, checkout creation, mailbox creation, and other non-idempotent operations. TanStack mutations should default to no retries; enable them only for explicitly idempotent mutations. See [providers.tsx](/E:/Coding/quieter/apps/web/src/components/providers.tsx:19) and [orpc-errors.ts](/E:/Coding/quieter/apps/web/src/lib/orpc-errors.ts:30).

2. **Chat generation durability relies on process-local state.** The in-flight run map and pub/sub bus only exist in one server process. Serverless replacement, multi-instance routing, or suspension can break generation ownership and streaming. See [lifecycle.ts](/E:/Coding/quieter/packages/orpc/src/chat/generation/lifecycle.ts:5) and [stream-chat-run.ts](/E:/Coding/quieter/packages/orpc/src/stream-chat-run.ts:36).

3. **Chat runs can become permanently or temporarily stuck.** A worker claims a run by moving it from `queued` to `running`, but another worker cannot resume it after that process dies. Recovery depends on a later read noticing staleness.

4. **Chat heartbeat writes can resurrect terminal runs.** Unawaited status updates can race completion or cancellation and overwrite `completed`/`cancelled` with `running` or `waiting_on_tool`. See [runner.ts](/E:/Coding/quieter/packages/orpc/src/chat/generation/runner.ts:185).

5. **Production and local database batch semantics differ.** Local `batch` executes statements sequentially without a transaction, while Neon is cast to the expected interface. Code using `batch` assumes atomicity, so local development cannot reliably reproduce production behavior. See [client.ts](/E:/Coding/quieter/packages/database/src/client.ts:42).

6. **Managed inbound ingestion is not atomic.** Message, attachment, label, and rule writes happen separately. A failed attachment insert can leave a message permanently incomplete because a retry sees the existing message and skips reconstruction. See [ingestion.ts](/E:/Coding/quieter/packages/orpc/src/managed-mail/messages/ingestion.ts:72).

7. **Organization API sends acknowledge success before durable bookkeeping.** Sent-message persistence and billing usage recording are launched without awaiting them. Serverless execution may end before either finishes. See [organization-mail.ts](/E:/Coding/quieter/packages/orpc/src/organization-mail.ts:125).

8. **Billing quota checks are race-prone.** Concurrent sends can all observe remaining quota and then collectively exceed it. The check and usage event insertion need an atomic reservation or serialized ledger operation.

9. **Billing reporting can duplicate provider events.** Provider reporting happens before `reportedAt` is committed. If the provider accepts the event but the database update fails, retries may report it again. See [organization-mail-usage.ts](/E:/Coding/quieter/packages/billing/src/organization-mail-usage.ts:523).

10. **A privileged personal email is hardcoded into entitlement logic.** This is effectively a source-controlled billing bypass. Move internal/test entitlements into explicit administrative data with audit history. See [entitlements.ts](/E:/Coding/quieter/packages/billing/src/entitlements.ts:26).

11. **`pending` and `past_due` subscriptions receive paid access.** There is no explicit payment-confirmation requirement or bounded delinquency grace period. See [entitlements.ts](/E:/Coding/quieter/packages/billing/src/entitlements.ts:20).

12. **Organization entitlement depends on whichever admin currently has the best personal subscription.** Adding, removing, or demoting an admin can unexpectedly change the organization’s plan. Organizations need a stable billing owner/subscription relationship.

13. **Email HTML is rendered without a CSP safety net.** Sanitized dynamic HTML is assigned into a shadow root, but there is no Content Security Policy. Any sanitizer mistake has a much larger impact. See [message-body.tsx](/E:/Coding/quieter/apps/web/src/features/message-thread/components/message-body.tsx:48) and [start.ts](/E:/Coding/quieter/apps/web/src/start.ts).

14. **External email images are enabled by default.** That exposes user IP, client information, and open time to tracking pixels. For a privacy-oriented email client, blocking should be the conservative default. See [external-images-setting.ts](/E:/Coding/quieter/apps/web/src/features/settings/domain/external-images-setting.ts:8).

15. **Sensitive mail and chat data are cached unencrypted in `localStorage` for seven days.** This increases XSS impact, persists across session expiry, and risks storage quota failures. See [query-persister.ts](/E:/Coding/quieter/apps/web/src/lib/query-persister.ts:6).

16. **Raw AWS function endpoints bypass normal product policy.** The token-protected outbound handler can send arbitrary sender addresses without organization domain authorization, normal billing, or Sent persistence. If it has no active caller, remove it. See [outbound.ts](/E:/Coding/quieter/packages/aws/src/outbound.ts).

17. **User and organization deletion paths appear incomplete.** Missing cascades and partial cleanup can block deletion or leave billing, mail-domain, usage, and external storage records behind. See [organization.ts](/E:/Coding/quieter/packages/auth/src/organization.ts:56).

18. **There is no broad application-level abuse protection.** Expensive AI, Gmail, waitlist, authentication, and mail operations have no visible general rate-limiting strategy.

19. **AI generation has no hard cost budget.** A run can execute up to 15 iterations with a 16,384-token limit and high reasoning. A malicious or pathological conversation can be very expensive. See [run-chat-stream.ts](/E:/Coding/quieter/packages/ai/src/run-chat-stream.ts:13).

20. **Critical billing code has no test suite.** This combines with concurrency and entitlement issues to make revenue-impacting regressions likely.

## Database and data-model risks

21. **The repository makes almost no use of database transactions.** Multi-row state transitions are implemented through batches, `Promise.all`, or sequential writes.

22. **`db.batch` is being used as a transaction substitute.** Chat message/run creation and managed-mailbox/grant creation depend on all-or-nothing behavior that is not uniformly guaranteed.

23. **Most timestamps are `timestamp` without timezone.** Distributed workloads running across cloud runtimes, local machines, and user time zones should generally store absolute time using timezone-aware columns. See [schema.ts](/E:/Coding/quieter/packages/database/src/schema.ts).

24. **Many foreign keys do not define deletion behavior.** Auth sessions, accounts, passkeys, organization members, invitations, subscriptions, usage events, and chat data can block account or organization deletion.

25. **`user.defaultMailboxId` has no foreign key.** This avoids circular deletion problems but intentionally permits dangling IDs. Every read path must continue handling that indefinitely.

26. **Tenant identity is duplicated without composite foreign keys.** Tables such as message labels and attachments store both `mailboxId` and referenced entity IDs, but the database does not guarantee all referenced rows belong to that mailbox.

27. **Cross-mailbox corruption is therefore possible through an application bug.** Individual foreign keys are insufficient when tenant ownership must match across multiple rows.

28. **Several persisted JSON columns are typed as `unknown`.** Saved searches and similar data have no database-visible version or stable serialization contract.

29. **Persisted chat parts use a very permissive shape.** `type: string` plus arbitrary properties makes historical transcript compatibility difficult as rendering logic evolves.

30. **There is no explicit schema version for persisted chat parts.** Old tool results or content parts may become unreadable after UI changes.

31. **Rule label IDs are stored in JSON rather than a relation.** Referential integrity and cascade behavior have to be recreated manually in application code.

32. **Saved views reference labels by mutable normalized name.** Rules use IDs, but views use names. Renaming a label can silently break a saved view.

33. **Monetary bigint fields use JavaScript `number` mode.** This is convenient now but imposes the `Number.MAX_SAFE_INTEGER` ceiling on cumulative usage values.

34. **Several statuses and roles are free-form text.** Application validation helps, but corruption or manual database operations can introduce impossible states.

35. **Mailbox email address uniqueness is global.** This makes one address globally exclusive across all product contexts. That should remain an explicit product invariant because changing it later will require substantial migration work.

36. **Managed message bodies are duplicated in PostgreSQL and raw object storage.** This increases storage, backup, indexing, deletion, and breach exposure.

37. **There is no visible archival or partitioning strategy for high-growth tables.** Messages, usage events, chat messages, automation decisions, and sync data will grow continuously.

38. **There is no database-enforced active-backfill uniqueness.** Two callers can start competing backfills for the same rule.

39. **Message position allocation relies on optimistic uniqueness.** Concurrent chat message creation can collide and requires reliable conflict handling.

40. **The default AI model is embedded in the database schema.** Provider configuration changes become schema-level decisions rather than ordinary runtime configuration.

41. **Local and production use materially different database transports.** Local Postgres and production Neon HTTP can differ in transactions, connection semantics, batching, latency, and error behavior.

42. **The Neon client is cast to the desired database type.** The cast suppresses evidence that runtime capabilities may not actually match the declared interface.

43. **There are no tenant-isolation database tests.** Composite ownership mistakes are therefore left to code review and runtime behavior.

## Authentication, authorization, and legal state

44. **Google OAuth state is deleted before token exchange succeeds.** A transient provider failure burns the authorization attempt and forces the user to restart. See [service.ts](/E:/Coding/quieter/packages/orpc/src/mailbox/service.ts:433).

45. **Mailbox and Gmail credential writes are separate operations.** A failure between them can leave a mailbox without valid credentials or credentials without the intended mailbox state.

46. **Gmail token refresh has no singleflight or lease.** Concurrent requests can all refresh the same token and race credential writes. See [gmail-mailbox-access.ts](/E:/Coding/quieter/packages/orpc/src/gmail-mailbox-access.ts:122).

47. **Credential refresh and mailbox status updates are not atomic.** The credential may be valid while the mailbox says reconnect, or vice versa.

48. **Any relevant OAuth 400 response is treated as permanent reconnect.** Some transient or malformed-provider responses may incorrectly force reauthorization.

49. **The OAuth PKCE verifier is stored in plaintext.** It is short-lived, but database access during that window exposes an active authorization secret.

50. **Credential encryption is application-managed with shared environment secrets.** AES-GCM is appropriate, but there is no envelope encryption, managed key identifier, or centralized KMS audit trail.

51. **Encryption-key rotation depends on synchronized secrets across multiple platforms.** Operational mistakes can make credentials temporarily undecryptable.

52. **Authentication email delivery loops back through the public application API.** Signup and recovery emails depend on the web deployment, API-key configuration, organization domain state, and the outbound provider all working together. See [email.ts](/E:/Coding/quieter/packages/auth/src/email.ts).

53. **The auth singleton is initialized at import time.** This creates test warnings and makes configuration failures appear while importing otherwise unrelated modules.

54. **`trustedOrigins` appears tied to one base URL.** Preview deployments and additional legitimate domains can fail unless manually accounted for.

55. **Terms acceptance stores only a timestamp.** There is no accepted Terms version, Privacy version, document hash, or effective date. See [terms-acceptance.ts](/E:/Coding/quieter/packages/auth/src/terms-acceptance.ts:1).

56. **Legal documents themselves do not expose an effective version.** You cannot reliably prove which text a particular timestamp accepted.

57. **Signup acceptance is transferred through a cookie.** This is practical, but it remains an indirect legal-state mechanism that should be thoroughly tested for replay, expiry, and cross-tab behavior.

58. **Organization deletion performs external object deletion synchronously.** Large organizations can make account operations slow and fragile.

59. **External cleanup has no durable retry workflow.** Failed S3 or domain cleanup can become permanent orphaned state.

60. **Mail-domain creation provisions provider resources before persisting the database row.** A database failure can leave orphaned provider resources. See [mail-domains.ts](/E:/Coding/quieter/packages/orpc/src/routers/mail-domains.ts:102).

61. **Mail-domain removal deletes the database row before provider cleanup.** If cleanup fails, the resource is no longer represented locally and retrying becomes difficult. See [mail-domains.ts](/E:/Coding/quieter/packages/orpc/src/routers/mail-domains.ts:328).

62. **Mail-domain cleanup compresses multiple failures into a boolean.** There is no durable record of which exact resource remains.

63. **Authorization is concentrated in service assertions rather than reinforced by the database.** One missed assertion can become a cross-tenant access bug.

64. **There is no visible administrative audit log.** Domain changes, API-key operations, mailbox grants, member role changes, and billing-owner changes should be auditable.

## Billing and commercial-model risks

65. **A user can have multiple active subscription rows.** Entitlement selection simply picks the most recent qualifying row rather than enforcing one canonical subscription.

66. **Subscription reconciliation depends on checkout metadata.** Missing metadata causes paid subscriptions to be ignored with only a log message. See [index.ts](/E:/Coding/quieter/packages/billing/src/index.ts:255).

67. **Provider product discovery and creation happen during checkout.** Concurrent cold instances can race to create or update equivalent products and prices.

68. **The checkout `session_type: "one_time"` setting should be verified.** It is being used with recurring product behavior and may not reflect the intended provider semantics. See [index.ts](/E:/Coding/quieter/packages/billing/src/index.ts:223).

69. **Plan copy promises `$10 AI credits included`, but no enforceable AI credit ledger was found.** Usage is reported, but there is no visible budget, cutoff, or overage handling.

70. **Product copy promises user-supplied AI credentials, but no complete per-user BYOK implementation was found.** The repository primarily uses a server-side OpenRouter key.

71. **AI prices are hardcoded.** Provider pricing changes can silently make internal metering inaccurate.

72. **Pricing, model IDs, model defaults, and UI plan copy live in separate places.** They can drift without a failing test.

73. **Email is sent before usage accounting completes.** Accounting failure can produce free usage.

74. **Some usage-accounting failures are only logged.** There is no reconciliation queue to repair missing events from actual sends.

75. **Usage alerts appear to be persisted state, not delivered notifications.** A row marked as an alert does not ensure anyone is informed.

76. **No explicit organization billing owner exists.** Personal subscription state is being used as an organization-level commercial contract.

77. **Removing an admin can remove the organization’s entitlement.** This couples access control administration to payment state.

78. **Promoting a subscriber to admin can unexpectedly upgrade an organization.** The reverse coupling is equally surprising.

79. **The highest plan among qualifying admins wins.** That makes entitlement provenance difficult to explain and reconcile.

80. **There are no tests for provider webhook replay, ordering, duplication, or deletion events.**

81. **There are no concurrency tests for usage reservations or provider reporting.**

82. **Billing’s domain layer depends on transport-specific errors.** Throwing oRPC errors inside billing logic couples commercial rules to one API framework.

## Chat and AI risks

83. **The SSE endpoint performs generation side effects through GET.** GET is expected to be safe and may be retried, prefetched, cached, or replayed by infrastructure.

84. **A stream connected to the wrong instance may never see completion events.** It waits on local pub/sub rather than observing durable run state.

85. **The stream has no strong cross-instance heartbeat or terminal timeout.** It can remain open indefinitely after ownership moves elsewhere.

86. **Disconnect handoff refuses to enqueue when the local map still contains the run.** The serverless process can then be terminated despite believing it still owns generation.

87. **Draft and run terminal updates are not atomic.** The assistant message and run record can disagree about whether generation completed.

88. **Stale-run failure updates are not atomic.** A run may be failed while its draft still appears active, or the opposite.

89. **AI usage reporting is fire-and-forget.** Usage can be lost when execution ends immediately after generation.

90. **Cancellation polling does not have robust error handling.** A transient database failure can create an unhandled rejection or disable cooperative cancellation.

91. **Client stream retries continue indefinitely.** A permanently failed or unauthorized run can cause endless reconnect traffic. See [use-chat-run-stream.ts](/E:/Coding/quieter/apps/web/src/features/chat/hooks/use-chat-run-stream.ts:48).

92. **The client contains a hand-written partial SSE parser.** It assumes simple `data:` lines and `\n\n`, without complete multiline, CRLF, event, retry, or ID handling. See [chat-run-stream.ts](/E:/Coding/quieter/apps/web/src/features/chat/lib/chat-run-stream.ts).

93. **Chat list state polls every two seconds while any generation exists.** This becomes substantial background load with many concurrent users.

94. **There is no per-user or per-run hard spend limit.**

95. **There is no explicit generation wall-clock budget inside the AI loop.**

96. **Prompt and tool iteration counts are large enough for runaway behavior.**

97. **Prompts, prices, model IDs, and provider options are distributed across packages.** Changing models safely requires coordinated manual edits.

98. **Automation decisions do not persist a complete prompt/version identity.** Retrying an old event after a deployment can apply different classification logic.

99. **Persisted AI decisions may outlive the model behavior that produced them.** There is no general migration or re-evaluation policy.

100.  **The provider zero-data-retention option is injected through casts.** Privacy assumptions depend on undocumented or weakly typed provider behavior. See [openrouter.ts](/E:/Coding/quieter/packages/ai/src/openrouter.ts:10).

101.  **Email content is sent to third-party model infrastructure.** This should be treated as a central privacy architecture decision, not only a feature detail.

102.  **There are no AI-package tests for token budgeting, tool-loop termination, provider errors, or malformed outputs.**

103.  **Database chat types leak directly into frontend rendering.** UI compatibility is tied to persistence representation.

## Gmail synchronization and scalability risks

104. **The Gmail service is a roughly 2,000-line module.** It mixes HTTP transport, retry logic, MIME projection, batching, list operations, thread operations, mutations, and sync logic. See [service.ts](/E:/Coding/quieter/packages/gmail/src/service.ts).

105. **That module has very limited tests relative to its responsibility.**

106. **Gmail MIME field selection has a fixed nesting depth.** Deeply nested MIME messages can be incompletely retrieved.

107. **Batch failures fall back to many sequential requests.** Authentication, quota, or provider outages can turn one failure into a large burst of additional traffic.

108. **Foreground history synchronization has no clear page or time budget.** A mailbox with extensive history can exceed serverless execution limits.

109. **Draft retrieval can produce high parallel fanout.**

110. **Message and thread metadata are often fetched separately.** This increases provider request volume for list rendering.

111. **Maintenance scans every Gmail mailbox.** It does not first select only entitled or due mailboxes.

112. **The maintenance fanout is O(total Gmail mailboxes) every 15 minutes.** This will become expensive even when most mailboxes need no work.

113. **A single maintenance function performs the full fanout.** At scale, listing and enqueueing all mailboxes can exceed its execution window.

114. **The lease, visibility timeout, and function timeout are very close.** Little margin remains for slow provider calls, retries, or cold starts.

115. **WebSocket connection TTL is set only at connect time.** Ping traffic does not refresh it, so a healthy long-lived connection can disappear from the connection table. See [gmail-live-sync-websocket.ts](/E:/Coding/quieter/packages/aws/src/gmail-live-sync-websocket.ts:45).

116. **Browser reconnect attempts are not reset after a successful connection.** After enough lifetime disconnects, live sync permanently stops until remount. See [use-gmail-live-sync.ts](/E:/Coding/quieter/apps/web/src/lib/gmail/use-gmail-live-sync.ts:43).

117. **Live-sync connection lifecycle depends on search state.** Search changes can unnecessarily tear down and recreate the socket.

118. **The live-sync token is placed in a URL query string.** Although short-lived, query tokens can appear in proxy and infrastructure logs.

119. **Notification delivery failures other than stale connections are swallowed.** The queue message can be acknowledged even when users were not notified.

120. **Connection fanout uses broad parallelism.** Large mailboxes or organizations can trigger provider throttling.

121. **Polling is the fallback for dropped notifications, but observability does not show how often fallback is required.**

122. **Pub/Sub ingress treats transient and invalid failures similarly.** Error classification and retry intent are not explicit.

123. **Token-info verification adds another external request to authorization.** Local JWT verification could reduce latency and dependency failure modes.

124. **Many OAuth/provider requests lack explicit request timeouts.**

## Managed-mail correctness and search risks

125. **Managed thread identity can depend on the first available reference.** Out-of-order delivery can split one conversation into multiple threads permanently.

126. **There is no later thread-merging reconciliation.**

127. **Deleting the final database reference and deleting the S3 object are separate operations.** Concurrent reference changes can race object deletion. See [deletion.ts](/E:/Coding/quieter/packages/orpc/src/managed-mail/messages/deletion.ts:32).

128. **Failed object deletion is logged without a durable retry.**

129. **Outbound managed-mail persistence failures are swallowed after successful provider delivery.** Users may send mail that never appears in Sent. See [service.ts](/E:/Coding/quieter/packages/orpc/src/managed-mail/messages/service.ts:759).

130. **Outbound attachment persistence is not atomic with the message row.**

131. **Message lists appear to select wide message rows.** Large HTML/text bodies may be transferred from the database when the list only needs summaries.

132. **Every page performs a distinct count query.** This becomes expensive on large mailboxes.

133. **Malformed cursors silently reset to the first page.** Client bugs become confusing pagination behavior rather than explicit errors.

134. **Text search uses `%term%` matching.** Without trigram indexes, this requires scans at scale. See [compiler.ts](/E:/Coding/quieter/packages/orpc/src/managed-mail/search/compiler.ts:106).

135. **Full-text vectors are calculated at query time.** There is no visible generated/search-vector column with a GIN index.

136. **Recipient data is flattened into comma-separated text.** This produces substring false positives and poor indexing characteristics.

137. **Search date normalization uses local process timezone.** Results can differ between local development and distributed production regions. See [normalization.ts](/E:/Coding/quieter/packages/orpc/src/managed-mail/search/normalization.ts:21).

138. **Search has separate SQL and JavaScript evaluators.** Preview, rules, backfills, and live ingestion can develop semantic differences.

139. **Rule reordering consists of independent updates.** Partial failure can leave duplicate or inconsistent positions.

140. **Label reordering has the same problem.**

141. **Deleting a label manually rewrites saved views and rules before deleting it.** Failure halfway through leaves partially rewritten product state.

142. **Rule backfill is advanced by a read endpoint.** If nobody keeps the relevant UI open, work stops.

143. **Backfill is not a proper durable worker workflow.**

144. **Multiple UI tabs can process the same backfill concurrently.** There is no strong lease or compare-and-swap claim.

145. **The backfill cursor uses lexical random UUID order.** Newly inserted records can fall behind the cursor and be skipped.

146. **Backfill does not establish a stable snapshot boundary.**

147. **Backfill performs attachment lookups per message.** This creates an N+1 query pattern.

148. **Backfill errors are reduced to counters.** There is no durable per-message failure detail or retry queue.

149. **Cross-mailbox label operations are not reinforced by composite database constraints.**

150. **There is no visible attachment malware scanning or content-disarm pipeline.** That is a meaningful risk for a hosted email system.

151. **SPF, DKIM, and DMARC authentication outcomes are not stored or prominently modeled for managed inbound messages.**

## Browser security, privacy, and frontend state

152. **There is no visible Content Security Policy.**

153. **There is no visible `frame-ancestors` or equivalent clickjacking policy.**

154. **There is no visible Permissions Policy, Referrer Policy, or explicit HSTS configuration in application code.** Some may be supplied by hosting, but the repository does not make the contract explicit.

155. **Shadow DOM is being treated as an isolation boundary for email HTML.** It isolates styling, but it is not a security sandbox.

156. **The sanitizer processes `<style>` blocks but does not appear to apply the same CSS URL rewriting to inline `style` attributes.** A background image can potentially bypass the external-image preference. See [mail-html.ts](/E:/Coding/quieter/apps/web/src/features/message-thread/domain/mail-html.ts:377).

157. **Image blocking focuses on `<img src>`.** CSS images, SVG references, and future supported elements need equivalent treatment.

158. **Sender avatars automatically contact external avatar services.** This leaks user IP and sender-derived information independently of the external-image setting. See [sender-avatar.ts](/E:/Coding/quieter/packages/mail/src/sender-avatar.ts:59) and [sender-avatar.tsx](/E:/Coding/quieter/apps/web/src/components/sender-avatar.tsx:47).

159. **Gravatar hashes can be enumerable for known email addresses.**

160. **Google Fonts load before consent.** This introduces an unconditional third-party browser request. See [\_\_root.tsx](/E:/Coding/quieter/apps/web/src/routes/__root.tsx:13).

161. **The privacy policy does not appear to fully describe local mail caching, avatar providers, and font requests.**

162. **Query persistence uses an experimental persister API.**

163. **The persistence buster is manually maintained.** Forgetting to increment it after incompatible cache changes can restore invalid state.

164. **`localStorage.setItem` failures are not handled robustly.** Large threads and message bodies can exceed browser quota.

165. **The persistent cache namespace is not strongly user-scoped.** Session expiry or account switching can expose stale cached data from the previous session.

166. **Explicit signout cleanup is not sufficient for revoked, expired, or externally terminated sessions.**

167. **Seven-day cached email data can remain after server-side deletion.**

168. **`refetchOnRestore: false` can display stale restored mail until another synchronization trigger occurs.**

169. **Manual cache writes have to separately invoke persistence.** Missing one call creates reload-only consistency bugs.

170. **Several cache persistence calls rely on unsafe casts.**

171. **Compose autosave has multiple swallowed failures.** The UI can appear saved when local or remote persistence failed.

172. **Several `.catch(() => {})` paths suppress user-visible data-loss conditions.**

173. **Client-only settings are generally browser-scoped rather than account-scoped.** Preferences can leak between accounts using the same browser.

174. **The site-password exemption list is manually maintained.** Adding a legal or public route without updating it can accidentally make required content inaccessible.

175. **Custom API routes need an explicit CSRF posture.** The existing middleware is focused on server functions rather than all state-changing HTTP endpoints.

## React and UI maintainability

176. **React Doctor scored the source tree 35/100, “Critical.”** Generated output produced some false positives, but the source findings remain substantial.

177. **Refs are assigned during render in important hooks.** This blocks React Compiler optimization and can create subtle render-order behavior. See [use-chat-run-stream.ts](/E:/Coding/quieter/apps/web/src/features/chat/hooks/use-chat-run-stream.ts:48).

178. **Message selection has the same render-time ref mutation pattern.**

179. **Many components subscribe to entire query result objects.** This causes unnecessary rerenders when unrelated result fields change.

180. **There are dozens of manual memoizations despite React Compiler being enabled.** This creates complexity while the compiler still bails out on several components.

181. **Compiler bailouts and manual memoization coexist without a clear strategy.** Either make components compiler-compatible or document deliberate exclusions.

182. **Several components initialize state from props and then allow it to diverge.** This can create stale state when the parent changes.

183. **Very large components and modules are common.** Notable examples include the Gmail service, database schema, auth visual, message view, and sync service.

184. **The React Doctor giant-component rule is disabled.** That hides a known maintenance problem rather than controlling it.

185. **The auth visual alone is over a thousand lines of shader/rendering behavior.** It should be isolated from authentication correctness and bundle-critical code.

186. **The Vite chunk warning threshold is raised to 1.2 MB.** This reduces warning noise by accepting larger chunks instead of preventing them. See [vite.config.ts](/E:/Coding/quieter/apps/web/vite.config.ts:31).

187. **There are no UI component tests despite a 38-source-file shared UI package.**

188. **There are no browser end-to-end tests for login, OAuth, compose, sending, billing, managed mail, or chat.**

189. **Accessibility is primarily enforced by convention.** There is no automated browser-level accessibility suite.

190. **Feature error boundaries are limited.** A failure in a large workspace subtree can take out more UI than necessary.

## Package and architecture boundaries

191. **The web application imports the database package directly.** The waitlist route violates the documented oRPC boundary. See [waitlist.ts](/E:/Coding/quieter/apps/web/src/routes/api/waitlist.ts:1).

192. **The waitlist endpoint therefore owns database behavior outside the designated service layer.**

193. **Frontend code imports database persistence types.** UI contracts are tied to Drizzle schema representation.

194. **Database migrations can consequently become frontend type changes.**

195. **The oRPC package exports many source-level internal subpaths.** The effective public API surface is much larger than a controlled service boundary. See [package.json](/E:/Coding/quieter/packages/orpc/package.json).

196. **Most internal packages export raw TypeScript source.** They depend on Bun/Vite/SST being able to compile workspace source correctly.

197. **That JIT-package strategy makes standalone tooling and future runtime migration harder.**

198. **The current boundary checker is narrow.** It primarily protects AWS handlers from unsafe oRPC imports and does not enforce the full architecture described in `AGENTS.md`.

199. **Regex import checks do not catch every dynamic import, re-export, alias, or runtime dependency path.**

200. **`@quieter/mail` is described as pure mail logic but depends on runtime environment configuration for avatar derivation.** Pure parsing/domain logic and provider-backed avatar configuration should be separated.

201. **The auth package coordinates billing, database, mail, and external object cleanup.** That makes authentication hooks a high-coupling orchestration layer.

202. **Deletion workflows are embedded in synchronous auth lifecycle hooks.** They would be safer as durable application workflows.

203. **The billing package is coupled to the API transport through oRPC errors.**

204. **AI code depends on Gmail concepts.** This makes adding another mailbox provider or generic managed-mail AI behavior harder.

205. **The public SDK is only a placeholder.** See [index.ts](/E:/Coding/quieter/packages/sdk/src/index.ts).

206. **The OpenAPI document is manually maintained.** It can drift from the actual validation and handler implementation. See [openapi.ts](/E:/Coding/quieter/apps/web/src/routes/api/openapi.ts:3).

207. **The OpenAPI version is a hardcoded `0.1.0`.** There is no release linkage or compatibility policy.

208. **The public API has no explicit idempotency-key mechanism for mail sends.**

209. **Resolved:** The API error schema rejects additional properties, giving clients a stable structured error contract.

210. **Provider-specific concepts are spread through product, service, infrastructure, and UI packages.** This makes provider replacement disproportionately expensive.

## Infrastructure and serverless operations

211. **Production resources use retain-on-removal.** This protects data but makes renamed and removed infrastructure accumulate unless explicitly cleaned up. See [sst.config.ts](/E:/Coding/quieter/sst.config.ts).

212. **The raw-mail bucket has no visible lifecycle policy.**

213. **There is no explicit object versioning, retention class, or archival strategy in infrastructure code.**

214. **The inbound receipt function has no visible DLQ or failure destination.**

215. **The chat queue has no equivalent DLQ configuration to the Gmail queue.**

216. **The Gmail DLQ has no visible alarm or automated operator workflow.**

217. **No infrastructure alarms are defined for function errors, queue age, DLQ depth, billing failures, or stuck chat runs.**

218. **Log retention is not explicitly managed.**

219. **Reserved concurrency and cost-containment settings are not explicit.**

220. **Mail outbound permissions include broad SES resources.** Reduce wildcard IAM where the provider permits it.

221. **Bearer-protected function URLs are used for internal integration.** Exposure depends entirely on secret confidentiality.

222. **Resolved:** Internal function bearer tokens use constant-time comparison.

223. **The raw inbound utility is another production-exposed bypass surface.** If it only supports development or migration, it should not exist in production.

224. **Raw inbound payload size is not visibly bounded before processing.**

225. **Raw email content is loaded fully into memory.** Large messages can pressure function memory and timeout budgets.

226. **Resolved:** Receipt processing logs only non-identifying operational metadata.

227. **PII logging and log retention are not coordinated through an explicit policy.**

228. **Receipt usage-accounting failure can retry an already persisted message.** Idempotent insertion helps, but downstream rules and accounting still need complete idempotency.

229. **There is no general orphan-reconciliation job for object storage and database references.**

230. **Several external requests lack explicit timeout and abort behavior.** A hung provider can consume the full function duration.

231. **Resolved:** Function responses use stable generic errors instead of raw exception messages.

232. **There is no structured logging or correlation-ID standard across web, workers, queues, and provider calls.**

233. **Backend/SST functions are not visibly connected to Sentry or another distributed tracing system.**

## Build, dependency, and CI/CD risks

234. **Core dependencies include beta releases.** Drizzle beta and Nitro beta increase upgrade and regression risk. See [package.json](/E:/Coding/quieter/package.json).

235. **Many core dependencies use caret ranges.** Lockfiles help, but deliberate upgrade control is still important with an unstable stack.

236. **There is no visible Dependabot or Renovate configuration.**

237. **Several packages use duplicate or potentially misplaced dependencies.** This makes ownership and upgrade scope less clear.

238. **Resolved:** Vite+ now owns workspace task execution, caching, and static checks.

239. **Resolved:** Vite Task derives workspace ordering from package dependencies instead of a separate task graph.

240. **CI does not appear to use affected-package execution.** Small changes run broad monorepo checks.

241. **Resolved:** Vite Task tracks inputs per task instead of applying a global environment-file dependency.

242. **Resolved:** Task-specific environment configuration lives with the Vite+ task that consumes it.

243. **The base TypeScript configuration uses `skipLibCheck`.** Dependency type incompatibilities can remain hidden.

244. **`noUncheckedIndexedAccess` is not enabled.** Array/map indexing receives more optimistic types than runtime guarantees.

245. **`exactOptionalPropertyTypes` is not enabled.** `undefined` and absence are conflated throughout API/domain types.

246. **Critical production variables are optional in the web server schema.** A deployment can start successfully and fail only when a feature is used.

247. **Resolved:** Service URL environment variables reject non-HTTP schemes, and deploy hooks require HTTPS.

248. **SST schemas require broad provider configuration even for unrelated local tasks.** This increases local coupling and setup fragility.

249. **GitHub actions are pinned to release tags rather than immutable SHAs.**

250. **Resolved:** The SDK publish workflow installs a pinned npm version.

251. **The production workflow combines migrations, infrastructure deployment, application deployment, and credential rotation.** Partial failure can leave a mixed production state.

252. **There is no automatic rollback across those systems.**

253. **The deployment workflow relies heavily on every migration remaining expand-compatible.** The convention is good, but app-version compatibility is not automatically tested.

254. **Resolved:** Credential rotation uses the configured canonical production URL.

255. **The custom production workflow is the sole release path.** This intentionally centralizes deployment, but makes the workflow a single release-path dependency.

256. **There is no alternate documented recovery deployment path if GitHub Actions or a provider integration is unavailable.**

257. **The chunk-size warning was loosened rather than paired with a bundle budget.**

258. **There is no dependency/license/security audit step visible in the standard quality workflow.**

## Testing and observability gaps

259. **Only about 25 test files cover roughly 400 TypeScript source files.**

260. **`packages/billing` has no tests.**

261. **`packages/ai` has no tests.**

262. **`packages/ui` has no tests.**

263. **`packages/deployment` has no tests.**

264. **The web app has only a small number of tests relative to more than 200 source files.**

265. **AWS has almost no behavior tests beyond limited Pub/Sub coverage.**

266. **There are no database-backed integration tests for authorization boundaries.**

267. **There are no transaction/partial-failure tests for multi-row operations.**

268. **There are no concurrency tests for OAuth refresh, sends, quota reservations, rule backfills, or chat ownership.**

269. **There are no multi-instance chat streaming tests.**

270. **There are no browser tests for session expiration and persisted-cache isolation.**

271. **Email HTML sanitizer tests are far too small for the attack surface.**

272. **There are no adversarial tests for CSS URLs, SVG, malformed HTML, data URLs, nested MIME, or tracking constructs.**

273. **There are no tests for account and organization deletion with realistic dependent data.**

274. **There are no tests proving all raw objects are removed when the final managed-message reference is deleted.**

275. **There are no restore or disaster-recovery tests represented in the repository.**

276. **Resolved:** Production client tracing uses a bounded nonzero sample rate.

277. **Most backend failures use `console` rather than structured events.**

278. **There are no visible dashboards or alerts for billing drift.**

279. **There are no visible alerts for failed outbound persistence.**

280. **There are no visible alerts for stuck chat runs.**

281. **There are no visible alerts for Gmail credential refresh failures or growing reconnect populations.**

282. **There is no metric showing live-sync delivery success versus polling fallback.**

283. **There is no metric showing AI cost by feature against plan revenue.**

284. **There is no metric showing untracked S3 objects or dangling database references.**

## Smaller decisions worth keeping in mind

285. **The route tree is generated and correctly treated as generated, but routing remains dependent on generation being current during all build paths.**

286. **Resolved:** The OpenAPI endpoint is served without caching.

287. **Error messages sometimes encode implementation assumptions that can become inaccurate as providers change.**

288. **Resolved:** Invalid managed-mail cursors return an explicit bad-request error.

289. **Multiple places create fresh provider clients rather than consistently reusing cached instances.**

290. **Some exact provider model names are persisted or exposed internally.** Model retirement will require migration and compatibility decisions.

291. **Long-lived preference feedback is retained after disabling useful details.** This may be intentional, but deletion and privacy expectations must remain explicit.

292. **Browser preference keys are effectively permanent public contracts.** Renaming them requires migrations or intentional resets.

293. **The site’s visual effects are computationally complex for an authentication screen.** They increase bundle and GPU cost in a critical conversion path.

294. **The current architecture has several separate “eventually consistent” systems without a shared reconciliation framework.** Mail persistence, usage accounting, AI usage, S3 cleanup, OAuth status, and provider resources each solve recovery differently.

295. **The documented product invariants are stronger than the automated enforcement.** `AGENTS.md` contains many crucial rules that currently rely on developer memory.
