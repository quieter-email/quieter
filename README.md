# quietr

`quietr` is a Bun + Turbo monorepo with a TanStack Start app and shared packages for auth, database, oRPC, and UI.

## Tech stack

- Runtime and package manager: Bun
- Monorepo orchestration: Turborepo
- Infrastructure and deployment: SST
- App framework: TanStack Start + TanStack Router + React
- App runtime/build: Vite + Nitro
- Forms: TanStack Form
- Client workflow state: TanStack Store
- Keyboard shortcuts: TanStack Hotkeys
- URL query state: TanStack Router validated search params
- Theme management: next-themes
- API layer: oRPC + `@orpc/tanstack-query`
- Database layer: Drizzle ORM beta + Postgres (Neon HTTP)
- Styling: Tailwind CSS v4
- UI primitives: Base UI
- Drawer and sheet primitives: Vaul
- Toast notifications: Sonner
- Icons: Hugeicons React
- Rich text editor: Tiptap
- Linting and formatting: Oxlint + Oxfmt
- Type checking: TypeScript native preview (`tsgo`)

## Workspace layout

- `sst.config.ts`: SST config that provisions the mail S3 bucket, the SES receipt SNS topic, the SES receipt IAM role, the mail ingest/send secret placeholders, the receipt processor, and the standalone mail ingress/outbound function URLs

- `apps/web`: TanStack Start app
  - `vite.config.ts`: Vite config that wires TanStack Start, React, Tailwind CSS v4, and Nitro
  - `src/router.tsx`: TanStack Router bootstrap with `routeTree.gen.ts` and scroll restoration
  - `src/routeTree.gen.ts`: generated TanStack Router route tree; do not hand-edit
  - `src/routes/__root.tsx`: root HTML shell, stylesheet/meta registration, providers, and app-level error/not-found UI
  - `src/routes/index.tsx`: authenticated inbox route; server-loads only auth/scope-repair state, redirects to the blocking Google scope-repair page for the exact broken mailbox when needed, and then hydrates the client workspace
  - `src/routes/google-scope-repair.tsx`: blocking Google scope-repair page that names the affected mailbox and routes the user back through targeted relinking
  - `src/routes/auth.tsx`: legacy auth route that redirects to `/login`
  - `src/routes/home.tsx`: public landing route that redirects authenticated users to the inbox
  - `src/routes/login.tsx`: public login route for magic link, Google, and passkey sign-in
  - `src/routes/signup.tsx`: public signup route for magic link registration plus Google and passkey entry points
  - `src/routes/settings.tsx`: authenticated settings route with server-side session guard
  - `src/routes/api/orpc.ts` and `src/routes/api/orpc.$.ts`: oRPC HTTP endpoints via TanStack Start server handlers (`/api/orpc`) that call `RPCHandler.handle(...)` directly, including auth email preview and user-status helpers used by login/signup
  - `src/routes/api/auth.$.ts`: Better Auth route handler
  - `src/routes/api/auth.google-scope-repair.ts`: server-side Google OAuth scope repair endpoint that starts targeted Better Auth relinking, hints the affected Google account, and preserves OAuth state cookies
  - `src/lib/orpc.ts`: shared isomorphic oRPC client plus TanStack Query oRPC utilities, using a router-backed server-side client during SSR and the fetch RPC client in the browser
  - `src/lib/auth.server.ts`: request-scoped server helpers for session lookup and blocking Google-scope repair target resolution
  - `src/lib/auth.functions.ts`: TanStack Start server functions used by route loaders for auth and repair checks
  - `src/lib/route-apis.ts`: typed TanStack Router route APIs used by shared client components
  - `src/lib/google-scope-repair.ts`: shared app-side helpers for canonical Google scope-repair URLs and safe return paths
  - `src/lib/query-client.ts`: shared React Query client factory
  - `src/lib/query-persister.ts`: shared TanStack query persistence helpers with eager browser-cache restore, manual cache writes, and persister-backed cache removal
  - `src/lib/search-params.ts`: shared TanStack Router search validation, normalization, and serialization for mailbox, auth, and settings URL state
  - `src/lib/auth.ts`: Better Auth React client wrapper
  - `src/lib/errors.ts`: shared client-side helpers for turning provider, auth, oRPC, and JSON-shaped failures into user-facing messages
  - `src/lib/gmail/compose.ts`: compose draft/session types, Gmail draft hydration, attachment runtime handling, and send/delete helpers through oRPC
  - `src/lib/gmail/compose-store.ts`: mailbox-scoped TanStack Store model for compose dialog workflow state and draft/form synchronization
  - `src/lib/gmail/compose-query.ts`: persisted compose session query keys scoped by `mailboxId`
  - `src/lib/gmail/mailbox-workspace-store.ts`: TanStack Store helpers for inbox-shell manual refresh, window activity, and pending mailbox action state
  - `src/lib/gmail/attachments.ts`: on-demand Gmail attachment download helpers used by mail detail surfaces
  - `src/lib/gmail/inbox-query.ts`: mailbox-scoped inbox query keys, Gmail-search-aware list loading, history-based live sync for unfiltered views, optimistic single-message actions, mailto-based unsubscribe actions, and thread-aware mailbox action helpers used by bulk selection and conversation-surface spam/trash actions
  - `src/lib/gmail/thread-query.ts`: thread query options
  - `src/lib/gmail/labels-query.ts`: Gmail label query options used by message actions
  - `src/lib/mailboxes-query.ts`: active-organization mailbox query options used by the inbox shell and settings
  - `src/components/providers.tsx`: client providers for next-themes and React Query under the TanStack Start root route
  - `src/components/mailbox-workspace.tsx`: interactive inbox shell using React Query, TanStack Router search state, active-organization mailbox selection, Gmail search queries, compose/message state, and bulk mailbox action handlers
  - `src/components/auth-screen.tsx`: auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and oRPC auth lookups
  - `src/components/settings-screen.tsx`: settings shell that wires tab state, session data, and the settings panels
  - `src/components/settings/*.tsx`: modular settings sidebar, panels, account dialogs, the personal-mailbox management panel, and the organization mail setup/test panel
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose
  - `src/components/mail-sidebar.tsx`: user profile, connected mailbox switcher, and mailbox-folder navigation, including Inbox, Drafts, Spam, Sent, and Trash
- `packages/auth`: Better Auth server configuration
  - `src/index.ts`: Better Auth config with Google OAuth, passkeys, magic links, linked-account support for multiple Google accounts, personal-organization repair, email-change verification placeholders, account deletion, and TanStack Start cookies
  - `src/organization.ts`: helpers for guaranteeing a personal organization per user and keeping `activeOrganizationId` valid
  - `src/email-placeholder.ts`: in-memory placeholder store for magic-link and verification URLs
  - `src/google-scopes.ts`: required Google scopes for Gmail access
- `packages/database`: Drizzle schema, client, and migrations
  - `src/schema.ts`: auth tables, organizations, invitations, memberships, passkeys, mailbox records, mail domains, and captured mail metadata
  - `src/client.ts`: Neon + Drizzle client
  - `drizzle.config.ts`: Drizzle Kit config
- `packages/orpc`: shared oRPC router, context, server handler, and client
  - `src/compose.ts`: shared compose schemas plus robust mail-address parsing used by both the web app and Gmail draft mutations
  - `src/router.ts`: auth lookup procedures plus mailbox-scoped mail procedures for mailbox listing/sync, domain configuration, captured-message inspection, Gmail list/search procedures, Drafts listing/loading, mailbox history sync procedures, message actions, mailto-based unsubscribe sending, and thread-level mailbox mutations used by bulk selection and conversation-level spam/trash flows
  - `src/mailbox-service.ts`: mailbox ownership, personal Gmail mailbox sync, authorization, and disconnect helpers
  - `src/mail-service.ts`: mail-domain configuration, recipient-domain matching, sender-domain resolution, and inbound-message persistence helpers
  - `src/mail-aws-service.ts`: SES domain registration, DNS record generation, receipt-rule automation, domain-status reads, and managed send helpers
  - `src/gmail-service.ts`: shared Gmail API helpers and response typing used by the router and web app, including raw Gmail `q` filtering, Gmail system-label mailbox mapping, Gmail Drafts API helpers, `List-Unsubscribe` mailto parsing, and thread-level Gmail mutations
  - `src/server.ts`: `RPCHandler` wrapper
  - `src/client.ts`: typed `createOrpcClient`
  - `src/types.ts`: `RouterInputs` and `RouterOutputs` utility types
- `packages/aws`: standalone AWS handler package used by SST for mail ingestion and SES sending
  - `src/function-url.ts`: shared Lambda function URL helpers for bearer auth, JSON parsing, and JSON responses
  - `src/inbound.ts`: AWS function URL handler that accepts normalized inbound payloads, matches configured recipient domains, stores raw MIME in S3, and writes minimal envelope metadata to Postgres
  - `src/outbound.ts`: AWS function URL handler that sends outbound mail through SES for configured active sender domains
  - `src/receipt.ts`: SNS-driven SES receipt processor that indexes SES-stored S3 messages into Postgres
- `packages/ui`: shared Tailwind theme, next-themes wrapper, styled UI components built on Base UI, Vaul, and Sonner, plus the shared icon-button tooltip wrapper for icon-only controls
- `packages/config`: shared TypeScript config package

## Product shape

- Quietr is a Gmail client with first-class mailbox records.
- The signed-in user authenticates as themselves, but Gmail access is resolved through a selected mailbox in the active organization.
- Better Auth organizations remain the ownership boundary. Every user gets a non-deletable personal organization, and connected Gmail mailboxes live there as first-class mailbox records.
- Normal organizations still exist for settings and membership, but they can legitimately have zero mailboxes in the current implementation.
- Google access now requests `https://mail.google.com/` plus profile/email scopes so permanent delete is allowed, and the inbox route blocks on a dedicated repair page that names the exact broken mailbox and keeps targeting that mailbox until the missing scope is granted.
- Quietr supports Google, magic-link, and passkey sign-in.
- Inbox views support row selection with mailbox-aware bulk actions for loaded conversations and drafts, including avatar-slot selection, Shift range selection, Ctrl/Cmd toggles, and `Mod+A` / `Escape` list hotkeys.
- When Gmail exposes a `List-Unsubscribe` mailto target, message menus expose a single unsubscribe action that auto-sends the unsubscribe email through the signed-in account.
- Outbound auth email delivery is not configured yet, so magic links and email verification URLs are exposed through local placeholder endpoints during development.
- Personal Gmail connected through linked Google accounts remains the primary mailbox provider.
- Mail now has a minimal but real hosted flow: a protected API can register SES domains and return the required DNS records, SES can send outbound mail for configured active domains, SES receipt rules store inbound mail in S3, and an SNS-driven processor indexes the stored inbound messages into Postgres.

## Architecture flow

1. `apps/web/src/router.tsx` bootstraps TanStack Router with the generated `src/routeTree.gen.ts` and enables scroll restoration.
2. `apps/web/src/routes/__root.tsx` owns the root document, providers, global styles, and app-level error/not-found boundaries.
3. Route loaders use TanStack Start server functions from `src/lib/auth.functions.ts`, backed by `src/lib/auth.server.ts`, for request-scoped session and Google-scope repair checks.
4. Browser requests hit `apps/web/src/routes/api/orpc.ts` and `apps/web/src/routes/api/orpc.$.ts`, where TanStack Start server routes call the shared `RPCHandler` directly with an oRPC context.
5. `apps/web/src/lib/orpc.ts` uses an isomorphic client: the browser uses the fetch RPC link, while SSR uses the router-backed server-side client with request headers.
6. Browser-side TanStack Query persistence restores mailbox state before network sync, while oRPC talks directly to Gmail for deltas, reloads, and mutations. Manual refreshes for unfiltered mailbox views now walk Gmail history to completion, reconcile all loaded cached rows by message id, and only fall back to a broader page reload when Gmail history can no longer describe the delta.
7. The inbox shell first resolves the active organization's mailbox list, keeps validated mailbox state in TanStack Router search params, and only issues Gmail API calls for the selected mailbox.
8. Auth form preflight checks such as email-status and placeholder preview lookups run through oRPC query utilities instead of manual client `fetch` calls.
9. The protected mail control API creates or refreshes SES identities, configures a custom MAIL FROM domain, creates SES receipt rules, and returns the DNS records required for the domain.
10. SES receipt rules deliver inbound raw mail to S3 and publish receipt metadata to SNS.
11. The SST receipt processor consumes the SNS notifications, looks up the configured domain, and writes a minimal inbound row to Postgres using the S3 object created by SES.
12. The SST mail ingress function still accepts normalized inbound payloads from non-SES adapters when needed.
13. The SST mail outbound function accepts a normalized send payload, checks that the sender domain is configured and active, and hands the send to SES.

## TanStack conventions

- Use TanStack Query first for app-owned async/server state in React code, with named `queryOptions(...)` and `mutationOptions(...)` instead of inline config objects.
- Use TanStack Store for complex client-only workflow state that needs imperative reads or coordinated updates across async handlers, such as the compose dialog and mailbox action pending state.
- Keep Better Auth's native reactive hooks as the source of truth for auth-owned state such as `useSession`, `useActiveOrganization`, `useListOrganizations`, and `useListPasskeys`.
- In non-hook code, prefer query-client reads when shared caching matters, but call the underlying client directly for one-off writes when TanStack would only add indirection.
- Mailbox-scoped mail data must include `mailboxId` in its query keys so persisted browser caches do not bleed across connected inboxes.

## UI boundary

- `packages/ui` owns the shared, styled component surface for the monorepo.
- App code should import reusable controls from `@quietr/ui` instead of importing Base UI, Vaul, or Sonner directly.
- When a new primitive is needed, add or extend the wrapper in `packages/ui` first and then consume it from the app.
- Icon-only interactive controls should use the shared tooltip wrapper, keep a concise `aria-label`, and stay visually compact.

## Inbox sync strategy

- Inbox list and thread data are cached with TanStack Query and restored from browser storage before any network sync runs.
- The message list will auto-prefetch at most one extra page on mount to fill an empty viewport, which avoids chain-loading many pages before the user scrolls.
- The inbox search bar forwards raw Gmail advanced-search syntax to the Gmail API `q` parameter while still respecting the currently selected mailbox, including Drafts and Spam.
- Freshness uses Gmail `historyId` checks on mount, focus/reconnect, interval polling, and manual refresh.
- Automatic sync now consumes Gmail history deltas directly and patches/removes loaded cached messages by id instead of relying on a fixed loaded-message cutoff.
- Mailbox membership changes still refresh page 1 so the top of the list and Gmail pagination cursor stay canonical without brute-force reloading every cached page.
- Filtered search views and the Drafts mailbox fall back to manual refresh instead of history-based live sync.
- Mailbox reloads still fetch Gmail metadata directly, but `messages.get` calls are batched and trimmed with partial-response `fields` so refreshes are much cheaper.
- Sender avatars are derived at request time from the message sender and are not stored in Postgres.
- Thread bodies and non-inline attachment metadata are fetched on click for fast navigation with minimal background API usage.
- Manual `queryClient.setQueryData` updates are immediately written to local persistence via `persistQueryByKey` so optimistic UI changes survive reloads.
- Mailbox, thread, and label query keys are mailbox-scoped so restored browser caches stay isolated per connected inbox.
- Gmail REST calls are centralized server-side in `packages/orpc/src/gmail-service.ts`, with access tokens resolved from the selected mailbox's linked Google account through Better Auth.
- Bulk mailbox actions and conversation-surface spam/trash actions operate on the loaded row set in the current mailbox and use thread-level Gmail mutations for conversation views.
- Compose workflow state is owned by a mailbox-scoped TanStack Store, while the persisted compose session still lives in TanStack Query browser storage and draft content/attachments continue syncing through oRPC-backed Gmail draft APIs.
- Opening a saved draft hydrates the Gmail draft payload and attachment files back into the compose dialog so Drafts behaves like a resumable mailbox, not just a local draft shortcut.
- `New Mail` always opens a fresh blank draft; previous unsent work remains resumable through the compose dialog's `Continue last draft` affordance.

## TanStack Start routing notes

- File routes live under `apps/web/src/routes/**`.
- `apps/web/src/routes/__root.tsx` owns the root providers and global shell concerns.
- Prefer route loaders and TanStack Start server functions for auth checks, redirects, and request-scoped work. Keep interactive stateful inbox surfaces as client components backed by React Query and TanStack Store.
- Validate search with `validateSearch` and the shared schemas in `src/lib/search-params.ts`, then strip defaults with `stripSearchParams(...)` so URLs stay stable.
- On the inbox route, keep `loaderDeps` limited to `mailboxId` so message selection, mailbox folder changes, and search query changes do not invalidate auth/scope-repair loader work.
- API handlers live under `src/routes/api/**`.

## Getting started

```bash
bun install
bun run db:push
bun run dev
```

Open `http://localhost:3000`.

## Mail via SST

Mail infrastructure is the only part of this repo that runs through SST. The TanStack Start app is still started separately with `bun run dev`.

### Mail commands

```bash
bun run mail:dev
bun run mail:diff
bun run mail:deploy
bun run mail:deploy:production
bun run mail:remove
bun run mail:remove:production
```

`bun run sst:dev`, `bun run sst:diff`, `bun run sst:deploy`, and `bun run sst:remove` remain as shorter aliases for the `mail-dev` stage.

### Local development

1. Start the app normally:

```bash
bun run dev
```

2. In another terminal, start the mail SST stack:

```bash
bun run mail:dev
```

3. Set real tokens for the `mail-dev` stage if you do not want the placeholders:

```bash
bunx sst secret set MailIngestToken your-local-token --stage mail-dev --config sst.config.ts
bunx sst secret set MailSendToken your-local-send-token --stage mail-dev --config sst.config.ts
```

If you do not set them, the default dev placeholders are:

- `MailIngestToken`: `dev-mail-ingest-token`
- `MailSendToken`: `dev-mail-send-token`

4. Read the deployed outputs from `.sst/outputs.json`. The values you need are:
   - `mailIngressUrl`
   - `mailOutboundUrl`
   - `mailBucket`

### Configure or register a domain

Use the protected mail API to register a domain. The registration call creates or refreshes the SES identity, configures custom MAIL FROM, configures the SES receipt rule, and returns the DNS records to add:

```powershell
@'
import { registerMailDomain } from "./packages/orpc/src/mail-aws-service.ts";

const domain = await registerMailDomain({
  organizationId: "PUT_ORG_ID_HERE",
  domain: "example.test",
  s3Bucket: "PUT_BUCKET_FROM_SST_OUTPUTS_HERE",
});

console.log(domain);
'@ | bun --env-file=.env.local -
```

If you need an organization id first:

```powershell
@'
import { db, organization } from "@quietr/database";

const rows = await db
  .select({ id: organization.id, name: organization.name, slug: organization.slug })
  .from(organization);

console.log(rows);
'@ | bun --env-file=.env.local -
```

The response includes:

- the SES/DKIM verification status
- the inbound and outbound readiness flags
- the SES receipt rule name
- the exact DNS records to add for DKIM, inbound MX, and custom MAIL FROM

### Send a test inbound message without SES

Post directly to the SST function URL:

```powershell
$mime = @"
From: Sender <sender@outside.test>
To: hello@example.test
Subject: Mail test
Message-ID: <local-test-1@outside.test>

hello from mail
"@

$payload = @{
  mailFrom = "sender@outside.test"
  recipients = @("hello@example.test")
  subject = "Mail test"
  providerMessageId = "local-test-1"
  messageIdHeader = "<local-test-1@outside.test>"
  rawMimeBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($mime))
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri "PUT_MAIL_INGRESS_URL_HERE" `
  -Headers @{ Authorization = "Bearer your-local-token" } `
  -ContentType "application/json" `
  -Body $payload
```

Expected result: `201` with `stored: true`, the matched domain, and the S3 bucket/key.

### Send a test outbound message

Post directly to the outbound function URL:

```powershell
$payload = @{
  from = "test@example.test"
  to = @("success@simulator.amazonses.com")
  subject = "Mail outbound test"
  text = "hello from quietr mail"
} | ConvertTo-Json -Depth 10

Invoke-RestMethod `
  -Method Post `
  -Uri "PUT_MAIL_OUTBOUND_URL_HERE" `
  -Headers @{ Authorization = "Bearer your-local-send-token" } `
  -ContentType "application/json" `
  -Body $payload
```

Expected result: `201` with `sent: true` and an SES `messageId`.

The mailbox simulator address lets you test SES sending before you have production access or a verified recipient mailbox.

### What DNS records are required

For a newly registered domain in `eu-central-1`, the API returns records shaped like:

- 3 DKIM `CNAME` records: `<token>._domainkey` -> `<token>.dkim.amazonses.com`
- 1 inbound `MX` record for the domain: `10 inbound-smtp.eu-central-1.amazonaws.com`
- 1 custom MAIL FROM `MX` record for `bounce.<domain>`: `10 feedback-smtp.eu-central-1.amazonses.com`
- 1 custom MAIL FROM `TXT` record for `bounce.<domain>`: `"v=spf1 include:amazonses.com ~all"`

Once those records propagate, the same domain can send through SES immediately, and inbound mail starts flowing into S3 + Postgres as soon as the MX record points at SES and the sender routes mail there.

### Verify the result

Check the stored metadata row:

```powershell
@'
import { listMailMessagesForOrganization } from "@quietr/orpc/mail-service";

const rows = await listMailMessagesForOrganization({
  organizationId: "PUT_ORG_ID_HERE",
  limit: 10,
});

console.log(JSON.stringify(rows, null, 2));
'@ | bun --env-file=.env.local -
```

If you have AWS CLI configured, inspect the raw MIME object:

```bash
aws s3 cp s3://YOUR_BUCKET/THE_KEY_FROM_THE_RESPONSE -
```

Posting the same payload again with the same `providerMessageId` should return `duplicate: true`.

### Production deploy

Deploy only the mail stack:

```bash
bunx sst secret set MailIngestToken your-production-token --stage production --config sst.config.ts
bunx sst secret set MailSendToken your-production-send-token --stage production --config sst.config.ts
bun run mail:deploy:production
```

After deploy, read `mailIngressUrl`, `mailOutboundUrl`, and `mailBucket` from `.sst/outputs.json`, create domains against that bucket, and point SES or any upstream adapter at the matching function URL.

## Root commands

```bash
bun run dev
bun run mail:dev
bun run mail:diff
bun run mail:deploy
bun run mail:deploy:production
bun run mail:remove
bun run mail:remove:production
bun run lint
bun run lint:fix
bun run fmt
bun run fmt:check
bun run sst:dev
bun run sst:diff
bun run sst:deploy
bun run sst:remove
bun run typecheck
bun run build
bun run db:generate
bun run db:migrate
bun run db:push
```

## Database workflow

- Use `bun run db:push` to apply local schema changes.
- Use `bun run db:generate` and `bun run db:migrate` only when you explicitly want migration files and the migration runner involved.

## Environment notes

- `DATABASE_URL`: required Postgres connection string
- `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`: Google OAuth credentials
- `BETTER_AUTH_URL`: optional full origin (for example `https://app.example.com`), used verbatim when set. If unset, `VERCEL_URL` is used as the host with `https://` prepended.
- `BETTER_AUTH_SECRET`: Better Auth secret
- Outbound auth email delivery is not configured in Better Auth yet. Magic links and email-change verification still use local placeholder previews even though the standalone SES outbound endpoint now exists.
- `MAIL_INGEST_TOKEN`: shared bearer token required by the SST mail ingress function. In deployed stages it should come from the `MailIngestToken` SST secret instead of a local `.env` file.
- `MAIL_SEND_TOKEN`: shared bearer token required by the SST mail outbound function. In deployed stages it should come from the `MailSendToken` SST secret instead of a local `.env` file.
- `MAIL_S3_BUCKET`: default S3 bucket used when creating domains without an explicit bucket override. In deployed stages SST injects the bucket name automatically.
- `MAIL_S3_PREFIX`: optional default object-key prefix for captured raw messages; defaults to `mail/inbound`
- `MAIL_RECEIPT_TOPIC_ARN`: optional explicit override for the SES receipt SNS topic used by the protected registration API; if omitted locally, the API falls back to `.sst/outputs.json`
- `MAIL_RECEIPT_ROLE_ARN`: optional explicit override for the SES receipt IAM role used by the protected registration API; if omitted locally, the API falls back to `.sst/outputs.json`
- `MAIL_RECEIPT_RULE_SET_NAME`: optional explicit override for the SES receipt rule set name; defaults to `quietr-mail`
- `MAIL_STACK_OUTPUTS_FILE`: optional path override for reading `.sst/outputs.json` outside the default repo layout
- `AWS_REGION` or `AWS_DEFAULT_REGION`: AWS region used by the S3 uploader and the SST deploy commands
- `AWS_PROFILE` or standard AWS credential env vars: required when running the SST mail commands
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY`: Logo.dev publishable key used for sender avatars
- `VITE_LOGO_DEV_PUBLISHABLE_KEY`: backward-compatible fallback that the sender-avatar resolver reads directly when `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` is unset
- `sst.config.ts` provisions only the mail stack: `MailBucket`, `MailReceiptTopic`, `MailReceiptRole`, `MailIngestToken`, `MailSendToken`, the receipt processor, and the standalone `MailIngress` / `MailOutbound` function URLs. The web app continues to use its normal local and deployment path outside SST.

## Dependency management

- Root `package.json` uses Bun workspaces and `workspaces.catalog` for version pinning.
- Root `package.json` also mirrors the core React entries in a top-level `catalog` field so external tooling that does not understand `workspaces.catalog` can still detect the app stack.
- Workspace packages consume shared versions via `catalog:` references.
- Server-side workspace packages that read Node globals such as `process` should declare `@types/node` in `devDependencies` and opt into `compilerOptions.types: ["node"]` in their local `tsconfig.json` instead of relying on ambient globals.
