# Mobile MVP and delivery decision

This is the architecture decision for [QUIETER-138](https://linear.app/leanderriefel/issue/QUIETER-138/define-mobile-mvp-supported-platforms-and-delivery-architecture) under [QUIETER-97](https://linear.app/leanderriefel/issue/QUIETER-97/mobile-app). It selects a path for installable iOS and Android applications. It does not record a working mobile build, device test, provider approval, or store release.

The source review uses main at `935978cd2abd845abbe543da90d6ad2e593511bf`. Official documentation was checked on 16 November 2026. This planning allocation excludes dependency installation and native execution, so it uses the issue's evidence-backed decision acceptance instead of a runnable spike.

## Choose Capacitor for both phone applications

Use Capacitor 8 with a bundled Vite renderer that consumes `@quieter/app` and `@quieter/ui`. Ship an iOS application through TestFlight and the App Store, and an Android App Bundle through Google Play testing tracks and production. Both platforms are in the MVP. Neither has a committed release date.

This is a native container with a shared web UI. It does not promise React Native views or a SwiftUI rewrite. The native container must supply secure sessions, lifecycle handling, verified links, and attachment integration before release. Responsive web remains separately available.

| Choice | Evidence and consequence | Decision |
| --- | --- | --- |
| Capacitor 8 | Its [supported targets](https://capacitorjs.com/docs/getting-started/environment-setup) include iOS and Android. Its [workflow](https://capacitorjs.com/docs/basics/workflow) packages a web build into native projects. Quieter already mounts its shared DOM UI in a separate Electron renderer. | Selected. Reuse the complete mail UI and provider-neutral services, then add mobile host adapters. |
| Expo with React Native views | Better Auth has a [supported Expo integration](https://better-auth.com/docs/integrations/expo) with secure cookie storage. Quieter's current UI, rich-text editor, mail renderer, and IndexedDB cache depend on browser APIs. | Defer. It requires a second presentation implementation. Expo's [WebView component](https://docs.expo.dev/versions/latest/sdk/webview/) can host web content, but does not itself resolve Quieter's host contracts. |
| Responsive web alone | [QUIETER-140](https://linear.app/leanderriefel/issue/QUIETER-140/fix-responsive-mobile-mail-list-search-and-message-actions) is Done. Its [interaction baseline](responsive-mail.md) covers narrow mail layouts. | Keep as the browser experience. It does not satisfy installable application delivery. |

This choice follows source compatibility, not measured mobile performance. QUIETER-139 must prove the transport, session, and storage adapters on both platforms before QUIETER-141 depends on them. If those adapters cannot preserve the existing contracts, revise this decision with evidence rather than add provider-specific mobile behavior.

## Set the support target separately from the runtime floor

| Platform | Quieter MVP target | Native tools and delivery | Unproved platform gaps |
| --- | --- | --- | --- |
| iOS | iPhone, iOS 18 or later. This is a proposed product support floor, pending device verification. Capacitor's documented runtime floor is iOS 15. | [Capacitor iOS](https://capacitorjs.com/docs/ios) uses WKWebView and requires Xcode 26 or later on macOS. Use Swift Package Manager where the selected plugins support it. Distribute signed archives through TestFlight, then App Store review. | Keyboard and safe-area behavior, mail HTML, secure storage accessibility after lock, universal links, attachment handoff, process termination, and VoiceOver. |
| Android | Phones, Android 12 or later, with a supported updated System WebView. This is a proposed product support floor. Capacitor's runtime floor is API 24. | [Capacitor Android](https://capacitorjs.com/docs/android) uses Android Studio. The [environment guide](https://capacitorjs.com/docs/getting-started/environment-setup) requires Android Studio 2025.2.1 or later and Node 22 or later. Produce a signed App Bundle for [Play testing and review](https://support.google.com/googleplay/android-developer/answer/9859348). | Back navigation, keyboard resize, document permissions, app-link verification, backup exclusions, process death, and TalkBack. |

QUIETER-139 pins the compatible Capacitor patch, plugin versions, native toolchain, Android compile and target SDK, and minimum WebView version after checking current requirements. A runtime's oldest supported WebView is not evidence that Quieter's CSS, editor, and routing work there. QUIETER-142 records minimum and current stable OS versions, actual devices, and WebView versions. Tablet-specific layouts, foldable layouts, wearables, and older OS versions are deferred. No device compatibility is certified by this document.

## Reuse the complete source paths

The following paths are the implementation baseline, not just shared types to copy.

| Concern | Current source evidence | Mobile consequence |
| --- | --- | --- |
| Host and renderer | [Shared runtime](../packages/app/src/runtime.ts), [Electron renderer bootstrap](../apps/desktop/src/renderer/src.tsx), and [renderer build](../apps/desktop/electron.vite.config.ts) configure URL opening, API location, and notifications around the shared application. The runtime currently names only web and desktop. | Add a separate `apps/mobile` host in QUIETER-139 after ownership handoff. Bundle static assets. Do not package the Cloudflare server or make packages depend on an app. Do not import Electron code. |
| Authentication | [App auth client](../packages/app/src/lib/auth.ts) always includes the Electron proxy plugin. [Desktop auth contract](../packages/auth/src/desktop.ts) names an Electron client and callback. [Server auth](../packages/auth/src/index.ts) registers that plugin and explicit trusted origins. | A different origin or `apiBaseURL` alone does not create mobile auth. Separate platform adapters behind `packages/auth` and the existing app auth contract before mobile mounts account UI. |
| RPC transport | [Client factory](../packages/orpc/src/client.ts) accepts a custom fetch implementation. [App RPC configuration](../packages/app/src/lib/orpc.ts) supplies the typed client to query utilities. [Server route](../apps/web/src/routes/api/orpc.$.ts) builds request context. | Supply the authenticated mobile fetch to both RPC and runtime requests. Never call Gmail or the database from the container or UI. Preserve validation and request-local database handling. |
| Mail access and enrichment | [Mail router](../packages/orpc/src/routers/mail.ts) invokes [mail queries](../packages/orpc/src/mail/queries.ts). Queries authorize the acting user and mailbox, select the Gmail or managed service, and hydrate metadata before returning the thread. [Client thread query](../packages/app/src/lib/mail/thread-query.ts) consumes that result with [mailbox-scoped keys](../packages/app/src/lib/mail/thread-query-keys.ts). | Use `rpc.mail` and the existing query functions. Preserve attachments, inline images, importance, unsubscribe state, delivery metadata, and draft reminder intent. Test fields that are absent as well as present. Do not rebuild a smaller mobile message DTO. |
| Mailbox selection | [Mailbox procedures](../packages/orpc/src/routers/mail/mailboxes.ts), [mailbox service](../packages/orpc/src/mailbox/service.ts), and [client list query](../packages/app/src/lib/mailboxes-query.ts) supply accessible mailboxes and account-level lists. | Reuse default and global mailbox selection. Account-level mailbox lists need account cleanup. Mailbox-specific data, drafts, actions, and recovery retain `mailboxId`. |
| Recovery and cache | [Mail cache](../packages/app/src/lib/mail-cache.ts) uses IndexedDB with account and session ownership. [Query persister](../packages/app/src/lib/query-persister.ts) stores mail bodies separately. [Draft journal](../packages/app/src/lib/draft-recovery-journal.ts) and [draft restoration](../packages/app/src/features/compose/domain/draft-recovery.ts) preserve scope and warn about missing files and uncertain sends. | Preserve those ownership and recovery semantics through a storage adapter. Current strings in IndexedDB are not proof of native encryption or durable mobile storage. |

The source trace for a normal thread is provider adapter, authorized server query, metadata hydration, typed RPC, scoped TanStack Query, then shared message UI. The [message renderer](../packages/app/src/features/message-thread/components/message-body.tsx) also handles inline attachment resolution and external-image preferences. A mobile path must preserve that whole behavior, including the established sanitizer and remote-content policy.

## Define the minimum useful workflows

| Workflow | Required MVP behavior | Existing issue |
| --- | --- | --- |
| Sign in and mailbox access | System-browser sign-in, sign out, session expiry, cancellation, account switching, Gmail reconnection, and private or explicitly granted managed mailboxes. Default selection matches web. | QUIETER-139 |
| Read and navigate | Mailbox switching, inbox and thread reading, next and previous navigation, attachments, scoped search, loading, empty, and recoverable error states. Use the responsive interaction baseline. | QUIETER-139, verified in QUIETER-142 |
| Triage | Existing read and unread, archive, spam, trash, and labels through shared actions, with failure rollback. Expose additional productivity actions only when their owning contracts are verified and available on the approved base. | QUIETER-139, verified in QUIETER-142 |
| Compose | New message, reply, reply all, forward, To, Cc, Bcc, attachments, drafts, explicit send, saved state, recovery, and uncertain-send status. Keep the mailbox fixed for each compose session. | QUIETER-141 |
| Native behavior | Secure session persistence, cold and warm link handling, keyboard and safe areas, Android back, native file selection and attachment opening. External links leave the privileged app content. | QUIETER-139 and QUIETER-141, verified in QUIETER-142 |
| Recovery | Bounded cached reads, durable text checkpoints, reconnect refresh, actionable expired-session state, and safe failure after process termination. No automatic send after reconnection. | QUIETER-139 and QUIETER-141, verified in QUIETER-142 |

Defer team administration, domain setup, connector setup, API-key management, advanced automation editing, assistant chat, voice, widgets, share extensions, background mailbox sync, and remote push notifications. Account privacy and deletion access remain required even when administration is deferred. Calendar attachments may open established external links. Native calendar editing is outside this MVP.

Existing AI settings, private memory and reminders, and mailbox grants remain server-owned. Mobile must not activate automation, broaden permissions, or create a second personal-context store. If assistant features are added later, they use `loadAiAgentContext` and the established policy boundary.

## Keep authentication and Gmail consent separate

Use the existing Better Auth session as the application identity. Keep Google identity scopes from [google-scopes.ts](../packages/auth/src/google-scopes.ts) separate from Gmail authorization in [mailbox/service.ts](../packages/orpc/src/mailbox/service.ts). That service already creates server-held PKCE state, validates grants, and stores credentials server-side.

Google [forbids authorization inside developer-controlled embedded user agents](https://developers.google.com/identity/protocols/oauth2/policies). Open identity and Gmail consent in the system authentication browser. Do not load consent in the mail WebView or reuse the Electron client ID and callback scheme. A browser session and a WebView session are separate.

The QUIETER-139 auth adapter must satisfy these requirements before it is usable:

- Bind browser completion to a short-lived, single-use native handoff with state and PKCE. Validate the callback scheme or verified HTTPS host and path, the initiating attempt, and the acting account. Cancellation, expiry, replay, and a callback from a different account fail closed. A callback URL carries no reusable session credential or provider token.
- Keep the reusable application session in a native credential store. Use iOS Keychain or Android encryption backed by [Keystore](https://developer.android.com/privacy-and-security/keystore), with backup and restore behavior defined. Ordinary Preferences, localStorage, or an embedded client secret are not credential storage. Deny persistence when protected storage is unavailable.
- Let the native transport attach the session only to approved HTTPS API routes. Reject arbitrary hosts, redirects, and renderer-supplied credential headers. Follow the security intent of the [desktop request proxy](../apps/desktop/src/main/index.ts), without importing its Electron implementation. Keep raw credentials out of renderer replies, logs, links, screenshots, and telemetry.
- Reuse the server's Gmail OAuth and credential lifecycle. Browser completion must resolve to the same acting user before the app refetches mailboxes. Refresh tokens, decryption, Gmail REST, and provider refresh stay server-side. A Google identity token never authorizes mail.
- On logout or account change, invalidate the native session, pending handoffs, live connections, caches, and draft ownership before another account renders. An expired cached identity never authorizes a request or reveals another user's persisted mail.

There is no verified Capacitor adapter for these contracts in this repository. QUIETER-139 must first evaluate supported auth and protected-storage integrations against the installed Better Auth version. Its selected plugin or narrow native adapter needs a security review and explicit auth-owner handoff. This is a concrete implementation gap, not a claim that the Electron or Expo integration can be reused unchanged.

## Preserve transport and offline behavior

Capacitor's [HTTP plugin](https://capacitorjs.com/docs/apis/http) provides native requests, but bridge size limits and file transfer behavior need verification. Do not globally patch every fetch. Scope the mobile adapter to Quieter requests and preserve status codes, expected authorization errors, aborts, RPC serialization, and file contents. Exercise both managed and Gmail fixtures through the same contract. If streaming or file transport needs server changes, request the narrow contract before coding it.

Native lifecycle events from [the App plugin](https://capacitorjs.com/docs/apis/app) must refresh session and mailbox authorization on resume and invalidate stale queries. Existing WebSocket live updates are foreground hints, not a background delivery service. Reuse their authenticated ticket path and reconcile the inbox on reconnect. Never keep the phone alive by polling in the background.

The MVP is online for authoritative search, sync, mutations, and send. Previously cached content may be readable offline for the current authorized local account. Show stale or offline state. Revalidate access before network actions. Offline actions must not appear completed or enter an automatic mutation outbox. A send with an unknown outcome resolves through the existing operation status before another attempt.

Capacitor documents that [iOS may evict IndexedDB](https://capacitorjs.com/docs/guides/storage). Treat the mail cache as disposable. Durable draft text checkpoints require an encrypted native store behind the existing recovery journal, with account, session, mailbox, and revision isolation. Server drafts remain canonical. This storage adapter belongs to the shared cache owner with a recorded handoff. Do not add a competing recovery format or persistence service. Verify failed writes, low storage, background termination, cold restart, logout, and account replacement. Lost file bytes must produce the existing reattachment warning. Never show a saved indication without a confirmed checkpoint.

## Define native integrations and release ownership

| Integration or gate | Decision and acceptance owner |
| --- | --- |
| Static application delivery | QUIETER-139 owns a bundled renderer and native projects. [Capacitor configuration](https://capacitorjs.com/docs/config) reserves `server.url`, cleartext, and broad navigation overrides for development. Production must use packaged assets, strict navigation and bridge access, and store updates. No remote executable update channel is part of the MVP. |
| Links and mail content | QUIETER-139 owns verified iOS Universal Links and Android App Links following the [deep-link guide](https://capacitorjs.com/docs/guides/deep-links). Validate route input, then authorize the mailbox before navigation. Handle cold start, already-open app, signed-out user, deleted mailbox, and revoked grant. Quarantine untrusted mail HTML from native capabilities. |
| Attachments | QUIETER-141 owns picker permissions, URI-to-file conversion, cancellation, inline images, size limits, temporary-file cleanup, native preview or sharing, and recovery warnings. Verify binary transport and equal metadata in Gmail and managed mail. Do not ask for broad device storage or contacts access. |
| Notifications | Remote new-mail push is deferred. Foreground refresh and in-app reminders use shared behavior. There is no promise of notification delivery while suspended or quit. QUIETER-142 verifies this limitation is visible. A future push scope requires explicit consent, per-user device registration and revocation, private payloads, and a coordinator-owned server delivery contract. The [push plugin](https://capacitorjs.com/docs/apis/push-notifications) is only a client API, not that service. |
| Store policy and privacy | QUIETER-142 owns privacy disclosures, permissions, account deletion, telemetry consent, and current store-policy review. Check Apple's [minimum-functionality, login-service, and payment rules](https://developer.apple.com/app-store/review/guidelines/) for the actual feature set. Shared checkout links do not automatically belong in a store build. Decide their compliant treatment before submission. Store approval is not inferred from the runtime choice. |
| Release and support | Leander Riefel, the current epic assignee, is the accountable release and support owner. QUIETER-139 supplies platform and session ownership, QUIETER-141 supplies compose ownership, and QUIETER-142 assembles device evidence, store preparation, rollback and support instructions. The release owner approves signing access, beta membership, publication, and any platform deferral through protected workflows. This plan grants none of those permissions. |

## Use supported local tools in the implementation slice

This VPS review found `vp` 1.3.0 and the repository's Node 26.11.1 selection. This worktree has no local `node_modules` or native application package. No native tooling, simulator, device, provider consent, or signing access was exercised. Installed tools on another machine and a successful web build would not establish native readiness.

The first QUIETER-139 development unit must record the actual host and tool versions, pin dependencies through `vp`, generate a separate mobile project, and use the supported Capacitor build, sync, and run workflow. Package scripts must wrap those tools through `vp`, with generated assets and native project ownership documented. Use macOS and Xcode for iOS. Use Android Studio and its supported SDK and JDK for Android. No paid cloud build service or database is a prerequisite.

Use synthetic mail against approved development resources. Keep configuration reads in `@quieter/env` and sensitive server configuration in development SST Secrets and linked bindings. A phone's API URL must reach the approved development server. Device loopback is not VPS loopback. Document a narrowly scoped development connection and exact callback origins before consent testing. Keep local telemetry disabled, record owned ports and PIDs, and never reuse production credentials. Real Gmail write verification requires a dedicated mailbox and exclusive recorded provider ownership.

## Extend existing child acceptance without removing blockers

The live chain remains QUIETER-138, then QUIETER-139, then QUIETER-141, then QUIETER-142. QUIETER-140 remains the completed responsive baseline. The following requirements refine those existing issues and create no new backlog.

### QUIETER-139 proves the native foundation

- Record the pinned mobile toolchain and supported plugins. Produce installable development applications for both platforms with bundled shared UI. Distinguish build artifacts from install and launch evidence.
- Prove the session handoff and protected-storage requirements above, including cancellation, forged or replayed callbacks, expiry, lock, backup restore, account switching, and sign-out cleanup. Keep Gmail consent separate.
- Exercise private Gmail, private managed mail, explicitly granted managed mail, revoked grants, and inaccessible mailboxes. Verify default selection and scope across cached reads, search, thread navigation, and triage failures.
- Compare full thread and draft results with the established path, including inline images, attachments, optional metadata, derived importance, unsubscribe and delivery state, and reminder intent. Use synthetic fixtures first.
- Obtain narrow ownership handoffs for shared runtime and auth adapters, transport, cache storage, and verified-link association files. Keep schema, router registration, bindings, and broad exports with the coordinator. Supply actual local startup and failure diagnostics.

### QUIETER-141 proves compose and recovery

- Verify new, reply, reply all, and forward on each supported platform and mailbox provider, including To, Cc, Bcc, inline images, and file selection cancellation or permission denial.
- Verify server draft save, encrypted text checkpoint, cold recovery, low-storage failures, missing attachment warnings, and account or mailbox changes without cross-scope leakage. Reuse existing draft and journal contracts.
- Prove explicit send success, rejected requests, timeout with uncertain outcome, and recovery through send status without duplicate dispatch. Preserve existing send safeguards and confirmation requirements. No automatic send on reconnect.
- Supply device evidence for keyboard, safe areas, native file opening, and exit or back while edits are unsaved. Keep deferred desktop workflows out of the mobile route set.

### QUIETER-142 decides whether each platform can release

- Record the actual minimum and current stable OS and device matrix for both platforms. Include a small phone, a larger phone, updated and unsupported WebView behavior, VoiceOver, TalkBack, text scaling, reduced motion, and external keyboard navigation.
- Exercise offline launch after a prior session, cache eviction, network loss during read and send, resume after termination, expired identity and Gmail consent, revoked managed grants, storage failure, and recovery. Record performance and memory evidence on devices rather than claim desktop measurements apply.
- Validate cold and warm verified links, attachment permissions, private external-image handling, and the absence of promised background notifications. Verify accessible loading, empty, error, and retry states.
- Attach signed beta install and upgrade evidence, privacy and account-deletion flows, store disclosures, current policy review, release/support ownership, and rollback instructions. Signing, tester distribution, and store submissions require their own authorization and account access.
- Confirm both advertised platforms have verified release evidence. If either is delayed, coordinate availability wording through QUIETER-78 and QUIETER-97 before launch. Keep the other platform's limits explicit. Do not mark QUIETER-97 Done for this planning PR.

## Keep remaining gates visible

This document completes the planning decision only. No mobile session adapter, encrypted draft adapter, verified-link association, native build, store account access, consent, device test, signing, or release is established. These are implementation and external acceptance gates in the existing children, not missing evidence disguised as completed work.

Both iOS and Android remain planned, with no release window inferred. The current landing source reviewed here does not contain the historical explicit iOS and Android availability wording from QUIETER-138. QUIETER-78 still records that promise and requires a coming-soon treatment for unfinished capabilities. Keep that issue and QUIETER-97 linked to this decision. No landing code change is needed for a platform deferral in this slice because neither platform is dropped or assigned a launch date. Recheck actual public copy and approved store listings in QUIETER-142 before announcing availability.
