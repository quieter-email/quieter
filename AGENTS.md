# Agent Guide - quietr

Welcome! This guide is intended to get any AI agent or developer productive in the `quietr` monorepo quickly.

## Tech Stack

- Runtime and package manager: [Bun](https://bun.sh/)
- Monorepo orchestration: [Turborepo](https://turbo.build/repo)
- Infrastructure and deployment: [SST](https://sst.dev/)
- Frontend app: [TanStack Start](https://tanstack.com/start) + [TanStack Router](https://tanstack.com/router) + [React](https://react.dev/)
- App runtime/build: [Vite](https://vite.dev/) + [Nitro](https://nitro.build/)
- Forms: [TanStack Form](https://tanstack.com/form/latest)
- Client workflow state: [TanStack Store](https://tanstack.com/store/latest/docs/overview)
- Keyboard shortcuts: [TanStack Hotkeys](https://tanstack.com/hotkeys/latest)
- Routing: `src/routes/**` TanStack Router file routes and TanStack Start server handlers
- URL query state: TanStack Router validated search params
- Theme management: [next-themes](https://github.com/pacocoursey/next-themes)
- API layer: [oRPC](https://orpc.dev/docs/getting-started) + [`@orpc/tanstack-query`](https://orpc.dev/docs/integrations/tanstack-query)
- Database: [Drizzle ORM beta](https://orm.drizzle.team/) + Postgres (Neon HTTP)
- Styling: [Tailwind CSS 4](https://tailwindcss.com/)
- UI primitives: [Base UI](https://base-ui.com/)
- Drawer and sheet primitives: [Vaul](https://vaul.emilkowal.ski/)
- Toast notifications: [Sonner](https://sonner.emilkowal.ski/)
- Icons: [Hugeicons React](https://www.npmjs.com/package/@hugeicons/react)
- Rich text editor: [Tiptap](https://tiptap.dev/)
- Linting and formatting: [Oxlint](https://oxc.rs/docs/guide/usage/linter) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
- Type checking: TypeScript native preview (`tsgo` from `@typescript/native-preview`)

## Project Structure

- `sst.config.ts`: SST config that provisions only the mail S3 bucket, the SES receipt SNS topic, the SES receipt IAM role, the mail ingest/send secret placeholders, the receipt processor, and the standalone mail ingress/outbound function URLs.

- `apps/web/`: TanStack Start application.
  - `vite.config.ts`: Vite config that wires TanStack Start, React, Tailwind CSS v4, and Nitro.
  - `src/router.tsx`: TanStack Router bootstrap with `routeTree.gen.ts` and scroll restoration.
  - `src/routeTree.gen.ts`: Generated TanStack Router route tree; do not hand-edit.
  - `src/routes/__root.tsx`: Root HTML shell, stylesheet/meta registration, providers, and app-level error/not-found UI.
  - `src/routes/index.tsx`: Authenticated inbox route that server-loads only auth/scope-repair state, redirects to the blocking Google scope-repair page for the exact broken mailbox when needed, and then hydrates the client workspace.
  - `src/routes/google-scope-repair.tsx`: Blocking Google scope-repair page that names the affected mailbox and routes the user back through targeted relinking.
  - `src/routes/auth.tsx`: Legacy auth route that redirects to `/login`.
  - `src/routes/home.tsx`: Public landing route that redirects authenticated users away.
  - `src/routes/login.tsx`: Public login route for magic-link, Google, and passkey sign-in.
  - `src/routes/signup.tsx`: Public signup route for magic-link registration plus Google and passkey entry points.
  - `src/routes/settings.tsx`: Authenticated settings route with server-side guard.
  - `src/routes/api/orpc.ts` and `src/routes/api/orpc.$.ts`: HTTP endpoints for oRPC requests (`/api/orpc`) via TanStack Start server handlers that call `RPCHandler.handle(...)` directly, including auth email preview and user-status helpers for login/signup.
  - `src/routes/api/auth.$.ts`: Better Auth route handler.
  - `src/routes/api/auth.google-scope-repair.ts`: Server-side Google OAuth scope repair endpoint that starts targeted Better Auth relinking, hints the affected Google account, and preserves OAuth state cookies.
  - `src/lib/orpc.ts`: Shared isomorphic oRPC client plus TanStack Query oRPC utilities, using a router-backed server-side client during SSR and the fetch RPC client in the browser.
  - `src/lib/auth.server.ts`: Request-scoped server helpers for session lookup and blocking Google-scope repair target resolution.
  - `src/lib/auth.functions.ts`: TanStack Start server functions used by route loaders for auth and repair checks.
  - `src/lib/route-apis.ts`: Typed TanStack Router route APIs used by shared client components.
  - `src/lib/google-scope-repair.ts`: Shared app-side helpers for canonical Google scope-repair URLs and safe return paths.
  - `src/lib/query-client.ts`: Shared React Query client factory.
  - `src/lib/query-persister.ts`: Shared TanStack query persister helpers for eager browser-cache restore, manual cache writes, and persister-backed cache removal.
  - `src/lib/search-params.ts`: Shared TanStack Router search validation, normalization, and serialization for app URL state, including mailbox selection, mailbox search queries, and the Drafts and Spam mailboxes.
  - `src/lib/auth.ts`: Better Auth React client wrapper.
  - `src/lib/errors.ts`: Shared client-side helpers for turning auth, oRPC, provider, and JSON-shaped failures into user-facing messages.
  - `src/lib/gmail/compose.ts`: Mailbox-scoped Gmail draft hydration helpers, attachment runtime store, and compose draft/session types.
  - `src/lib/gmail/compose-store.ts`: Mailbox-scoped TanStack Store model for the compose dialog workflow, including UI state and draft/form synchronization.
  - `src/lib/gmail/compose-query.ts`: Persisted compose session query keys keyed by mailbox id.
  - `src/lib/gmail/mailbox-workspace-store.ts`: TanStack Store helpers for inbox-shell manual refresh, window activity, and pending mailbox action state.
  - `src/lib/gmail/attachments.ts`: On-demand Gmail attachment download helpers for mail detail surfaces.
  - `src/lib/gmail/inbox-query.ts`: Mailbox-scoped inbox query keys, Gmail-search-aware loading, history-based sync helpers for unfiltered views, optimistic message actions, mailto-based unsubscribe actions, and thread-aware mailbox action helpers used by bulk selection and conversation-surface spam/trash actions.
  - `src/lib/gmail/thread-query.ts`: Thread query helpers.
  - `src/lib/gmail/labels-query.ts`: Shared `queryOptions(...)` helpers for Gmail label metadata.
  - `src/lib/mailboxes-query.ts`: Shared `queryOptions(...)` helpers for mailbox records in the active organization.
  - `src/components/providers.tsx`: Client-side next-themes and React Query providers.
  - `src/components/mailbox-workspace.tsx`: Interactive inbox shell, TanStack Router search state, active-organization mailbox selection, Gmail search queries, message panes, compose modal, and bulk mailbox action handlers.
  - `src/components/auth-screen.tsx`: Client auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and oRPC auth lookups.
  - `src/components/settings-screen.tsx`: Client settings shell that wires tab state, session data, and the settings panels.
  - `src/components/settings/*.tsx`: Modular settings sidebar, panels, account dialogs, the mailbox-management panel, and the organization mail setup/test panel.
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance.
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose.
  - `src/components/mail-sidebar.tsx`: Sidebar showing the current user profile, connected mailbox switcher, and mailbox-folder navigation across Inbox, Drafts, Spam, Sent, and Trash.
- `packages/auth/`: Better Auth server package.
  - `src/index.ts`: Better Auth configuration with Google OAuth, passkeys, magic links, linked-account support for multiple Google accounts, personal-organization repair, account deletion, and TanStack Start cookies. `baseURL` is `BETTER_AUTH_URL` when set, else `https://${VERCEL_URL}` when set, else `http://localhost:3000`.
  - `src/organization.ts`: Helpers for guaranteeing a personal organization per user and keeping `activeOrganizationId` valid.
  - `src/email-placeholder.ts`: In-memory placeholder store for magic-link and verification URLs.
  - `src/google-scopes.ts`: Required Google OAuth scopes.
- `packages/database/`: Shared database package.
  - `src/schema.ts`: Drizzle schema definitions for auth, organizations, invitations, memberships (including per-user default mailbox preference), passkeys, mailbox records, mail domains, and captured mail metadata.
  - `src/client.ts`: Neon and Drizzle client setup.
  - `drizzle.config.ts`: Drizzle Kit configuration.
- `packages/orpc/`: Shared API contract + server/client helpers.
  - `src/compose.ts`: Shared compose schemas plus robust mail-address parsing used by both the web app and Gmail draft mutations.
  - `src/context.ts`: oRPC context creation.
  - `src/router.ts`: App router with auth lookup procedures plus mailbox-scoped mail operations, domain configuration, captured-message inspection, list/search procedures, Drafts listing/loading, mailbox history sync procedures, mailto-based unsubscribe sending, default-mailbox preference, and thread-level mailbox mutations used by bulk selection and conversation-level spam/trash flows.
  - `src/mailbox-service.ts`: Mailbox ownership, personal Gmail sync, authorization, and disconnect helpers.
  - `src/mail-service.ts`: Mail-domain configuration, recipient-domain matching, sender-domain resolution, and inbound-message persistence helpers.
  - `src/mail-aws-service.ts`: SES domain registration, DNS record generation, receipt-rule automation, domain-status reads, and managed send helpers.
  - `src/gmail-service.ts`: Shared Gmail response typing plus batched Gmail API helpers used by oRPC, including raw Gmail `q` filtering, Gmail Drafts API helpers, `List-Unsubscribe` mailto parsing, and thread-level Gmail mutations.
  - `src/server.ts`: `RPCHandler` integration.
  - `src/client.ts`: Typed client factory.
  - `src/types.ts`: `RouterInputs` and `RouterOutputs` utility types.
- `packages/aws/`: Standalone AWS handler package used by SST for mail ingestion and SES sending.
  - `src/function-url.ts`: Shared Lambda function URL helpers for bearer auth, JSON parsing, and JSON responses.
  - `src/inbound.ts`: AWS function URL handler that accepts normalized inbound payloads, matches configured recipient domains, stores raw MIME in S3, and writes minimal envelope metadata to Postgres.
  - `src/outbound.ts`: AWS function URL handler that sends outbound mail through SES for configured active sender domains.
  - `src/receipt.ts`: SNS-driven SES receipt processor that indexes SES-stored S3 messages into Postgres.
  - `package.json`: Package-scoped SST scripts for the `mail-dev` stage and production deploy/remove flows.
- `packages/ui/`: Shared UI package with the Tailwind theme, next-themes wrapper, styled component wrappers built on Base UI, Vaul, and Sonner, plus the shared icon-button tooltip wrapper for icon-only controls.
- `packages/config/`: Shared TypeScript config package.

## Core Concepts and Patterns

### Product model

- Quietr is a Gmail client with first-class mailbox records.
- The signed-in user authenticates as themselves, but Gmail access is resolved through the selected mailbox in the active organization.
- Each member can pin one mailbox as their default per organization (stored as `defaultMailboxId` on the `member` table). The default mailbox sorts first in the switcher and is auto-selected when no `mailboxId` search param is present or the param is invalid.
- Organizations are managed directly through Better Auth's organization plugin. Every user gets a non-deletable personal organization, and connected Gmail mailboxes live there as first-class mailbox records.
- Normal organizations currently support account/settings structure and membership only. They can exist with zero mailboxes in the current implementation.
- Google sign-in now requests `https://mail.google.com/` plus profile/email scopes so permanent delete is allowed, and the inbox route blocks on a dedicated repair page that names the exact broken mailbox and keeps targeting that mailbox until the missing scope is granted.
- When Gmail exposes a `List-Unsubscribe` mailto target, message menus expose a single unsubscribe action that auto-sends the unsubscribe email through the signed-in account.
- Passkeys are optional secondary sign-in credentials that can be added from settings after the user signs in with Google or magic link.
- Outbound auth email delivery is not configured right now, so magic links and email verification flows use local placeholder previews instead of real email sends.
- Inbox list views support row selection with mailbox-aware bulk actions for loaded conversations and drafts, including avatar-slot selection, Shift range selection, Ctrl/Cmd toggles, and `Mod+A` / `Escape` list hotkeys.
- Personal Gmail connected through linked Google accounts remains the primary mailbox provider.
- Mail now has a minimal but real hosted flow: a protected API can register SES domains and return the required DNS records, SES can send outbound mail for configured active domains, SES receipt rules store inbound mail in S3, and an SNS-driven processor indexes the stored inbound messages into Postgres.

### Monorepo boundaries

- `apps/web` should consume shared functionality via package imports (`@quietr/orpc`, `@quietr/config`).
- `apps/*` should consume reusable UI through `@quietr/ui`; do not import Base UI, Vaul, or Sonner directly in app code unless `packages/ui` is being extended in the same change.
- `packages/orpc` is the boundary between app and database logic.
- `packages/database` should own schema and migration concerns.
- `packages/auth` owns Better Auth configuration.
- Icon-only interactive controls should use the shared tooltip wrapper from `@quietr/ui`, keep a concise `aria-label`, and stay visually compact.

### TanStack Query, Store, and mutationOptions

- Use TanStack Query first for app-owned async/server state in React code.
- Use TanStack Store for complex client-only workflow state that benefits from imperative current-state reads or coordinated updates across async handlers.
- Use named `queryOptions(...)` and `mutationOptions(...)` when:
  - A query or mutation config is needed in more than one place.
  - You want a single source of truth for query keys, mutation keys, or cache behavior.
- Prefer extracting shared query and mutation options into colocated `*-query.ts` modules when they are reused.
- Pass the result of `queryOptions(...)` directly to `useQuery`, `prefetchQuery`, or other query methods, and pass the result of `mutationOptions(...)` to `useMutation(...)`; avoid duplicating keys or config inline.
- Keep Better Auth's native reactive hooks as the source of truth for auth-owned state such as `useSession`, `useActiveOrganization`, `useListOrganizations`, and `useListPasskeys`.
- In non-hook code, prefer query-client reads when shared caching matters, but call the underlying client directly for one-off writes when TanStack would only add indirection.
- Mailbox-scoped mail data must include `mailboxId` in its query keys so persisted browser caches do not bleed across connected inboxes.

### API and data flow

- App bootstraps TanStack Router from `apps/web/src/router.tsx` using the generated `routeTree.gen.ts`, and the root document/providers live in `apps/web/src/routes/__root.tsx`.
- Route loaders use TanStack Start server functions from `apps/web/src/lib/auth.functions.ts`, backed by `apps/web/src/lib/auth.server.ts`, for request-scoped session and Google-scope repair checks.
- App calls `@quietr/orpc` from `apps/web/src/lib/orpc.ts` through a shared isomorphic client and TanStack Query oRPC utilities; the browser uses the fetch RPC client while SSR uses the router-backed server-side client with request headers.
- Requests are handled in `apps/web/src/routes/api/orpc.ts` and `apps/web/src/routes/api/orpc.$.ts`, where TanStack Start server routes call the shared `RPCHandler` directly with an oRPC context.
- Router procedures cover auth email-status/preview lookups plus mailbox listing/sync and mailbox-scoped Gmail list/thread/history-sync/label/draft/attachment/message actions, including Drafts listing/loading and Spam/Not Spam flows.
- Mail domains can be configured dynamically through oRPC. The protected control plane creates or refreshes SES identities, configures custom MAIL FROM, creates SES receipt rules, and returns the exact DNS records required for the domain.
- SES receipt rules store inbound raw mail in S3 and publish receipt metadata to SNS.
- The SST receipt processor consumes the SNS notifications, matches recipients against active domains, and persists a small metadata row for inspection.
- The SST mail ingress function still accepts normalized inbound payloads from non-SES adapters when needed.
- The SST mail outbound function accepts normalized send payloads, requires a configured active sender domain, and sends through SES.
- Mailbox list queries can forward raw Gmail advanced-search syntax through the Gmail API `q` parameter while still applying the selected mailbox label, including Drafts and Spam.
- Browser-side TanStack Query persistence is the primary Gmail cache and is restored before inbox queries mount.
- Mailbox-scoped Gmail read models must include `mailboxId` in their query keys so persisted browser caches stay isolated per connected inbox.
- Sender avatars are derived at request time from the message sender and are not persisted in Postgres.
- Manual `queryClient.setQueryData` writes are persisted with `persistQueryByKey` so optimistic cache updates survive reloads.
- Gmail REST calls are executed server-side in `packages/orpc/src/gmail-service.ts`, with access tokens resolved from the selected mailbox's linked Google account through Better Auth.
- Bulk mailbox actions and conversation-surface spam/trash actions operate on the loaded row set in the current mailbox and use thread-level Gmail mutations for conversation views.
- Mailbox freshness uses Gmail history IDs, so background polling only reloads loaded pages when Gmail reports a relevant change.
- Manual refreshes for unfiltered mailbox views now walk Gmail history deltas to completion, reconcile loaded cached rows by message id, and only fall back to a broader page reload when Gmail history can no longer describe the mailbox state.
- Loaded mailbox rows are no longer gated by a fixed loaded-message sync cutoff; Gmail history deltas are intersected against the full cached mailbox window on the client.
- Message-list viewport prefetch is intentionally capped to one extra page on mount so tall windows do not chain-load many pages before the user scrolls.
- Filtered search views and the Drafts mailbox are refreshed manually instead of participating in history-based live sync.
- Thread bodies and non-inline attachment metadata are still fetched on demand from Gmail.
- Compose workflow state is owned by a mailbox-scoped TanStack Store, while the browser-local persisted compose session remains keyed by mailbox id in TanStack Query; draft content and attachments are synced to Gmail drafts via oRPC procedures, and reopening saved drafts hydrates Gmail-backed attachment files back into compose state.

### Routing + SSR behavior

- `apps/web/src/routes/__root.tsx` owns root-level providers, global styles, and the app shell.
- Prefer route loaders and TanStack Start server functions for auth guards, redirect-only checks, and request-scoped data loading before handing off to client components.
- Keep API handlers under `apps/web/src/routes/api/**`.
- Use client components for React Query, compose flows, and TanStack Router search-driven inbox state.
- Validate search through shared schemas in `apps/web/src/lib/search-params.ts`, and keep inbox `loaderDeps` limited to `mailboxId` so query, folder, and message-selection URL changes do not retrigger auth/scope-repair loader work.

### Database and migrations

- Schema changes go in `packages/database/src/schema.ts`.
- Use `bun run db:push` for local schema changes by default.
- Generate migrations with `bun run db:generate` and apply them with `bun run db:migrate` only when migration files are explicitly needed.
- Database connections use `DATABASE_URL`.

### Shared tooling and config

- Each workspace package has its own scripts and dev dependencies for `oxlint`, `oxfmt`, and `tsgo`.
- Shared TypeScript config is in `packages/config`, while Oxlint/Oxfmt config is at repo root.
- Server-side workspace packages that use Node globals such as `process` should declare `@types/node` in `devDependencies` and opt into `compilerOptions.types: ["node"]` in their package `tsconfig.json`.
- Root `package.json` keeps Bun versions in `workspaces.catalog` and mirrors the core React entries in a top-level `catalog` field for external tooling compatibility.
- Root `package.json` delegates mail SST commands to package-scoped scripts in `@quietr/aws` through Turbo; the web app is not started or deployed through SST.
- Root `sst.config.ts` provisions the mail bucket, SES receipt topic, SES receipt IAM role, receipt processor, and the standalone mail ingress/outbound functions through SST. It links the bucket to the functions for AWS permissions and injects the bucket name plus the ingest/send tokens into the deployed functions.
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` is used for sender avatars in the inbox UI.
- `VITE_LOGO_DEV_PUBLISHABLE_KEY` remains a backward-compatible fallback that the sender-avatar resolver reads directly when `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` is unset.
- Outbound auth email delivery is not configured in this repo right now, so magic links and email verification flows rely on placeholder previews during local development.
- `MAIL_INGEST_TOKEN` authenticates the SST mail ingress function.
- `MAIL_SEND_TOKEN` authenticates the SST mail outbound function.
- `MAIL_S3_BUCKET` is the default bucket for mail domains when no explicit bucket override is provided.
- `MAIL_S3_PREFIX` optionally sets the default object-key prefix and defaults to `mail/inbound`.
- `MAIL_RECEIPT_TOPIC_ARN` optionally overrides the SES receipt SNS topic used by the protected registration API; in local dev the API falls back to `.sst/outputs.json`.
- `MAIL_RECEIPT_ROLE_ARN` optionally overrides the SES receipt IAM role used by the protected registration API; in local dev the API falls back to `.sst/outputs.json`.
- `MAIL_RECEIPT_RULE_SET_NAME` optionally overrides the SES receipt rule set name and defaults to `quietr-mail`.
- `MAIL_STACK_OUTPUTS_FILE` optionally overrides where the protected registration API reads `.sst/outputs.json`.
- `AWS_REGION` or `AWS_DEFAULT_REGION` is required for the mail S3 uploader.

### Generated files

- Do not hand-edit generated Drizzle migration snapshots unless intentionally repairing generated output.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`; regenerate it through the TanStack Start/Vite build.

## Development Workflow

Root commands:

- `bun install`
- `bun run dev`
- `bun run mail:dev`
- `bun run mail:diff`
- `bun run mail:deploy`
- `bun run mail:deploy:production`
- `bun run mail:remove`
- `bun run mail:remove:production`
- `bun run sst:dev`
- `bun run sst:diff`
- `bun run sst:deploy`
- `bun run sst:remove`
- `bun run lint`
- `bun run lint:fix`
- `bun run fmt`
- `bun run fmt:check`
- `bun run typecheck`
- `bun run build`
- `bun run db:generate`
- `bun run db:migrate`
- `bun run db:push`

## Rules for Agents

1. Keep docs current: if architecture, package layout, routing, API contracts, schema, or tooling changes, update both `README.md` and `AGENTS.md` in the same PR.
2. Preserve package boundaries: avoid direct app-to-database coupling; route through `@quietr/orpc`.
3. Keep type safety strict: never use `any` or explicit casts unless absolutely necessary or you are told to do so; prefer inference and exported shared types.
4. Respect generated files: do not manually rewrite generated route tree or migration metadata without clear reason.
5. For schema changes, use `bun run db:push` by default and verify app behavior end-to-end; only generate/apply migrations when explicitly asked for, for now.
6. Before finishing work, first format using `bun run fmt`, then run `bun run lint:fix` and `bun run typecheck`, and fix any errors or warnings from the that come up.
7. Use `queryOptions` and `mutationOptions` when adding or refactoring TanStack Query usage in React code, but keep Better Auth's native reactive hooks native.
8. Prioritize clarity in inbox surfaces and keep the workflow simple.
9. For incremental UI refinement requests, preserve the existing layout, density, and component hierarchy unless the user explicitly asks for a redesign. Do not add helper copy, oversized controls, extra empty space, or decorative sections when the request is for a minimal change.
10. Follow [React's guidance on avoiding unnecessary Effects](https://react.dev/learn/you-might-not-need-an-effect): do not use `useEffect` to reset or mirror local UI state such as dialog forms when the same behavior can live in render logic, `key`s, or component events like `onOpenChange`.
11. Treat icon-only controls as ambiguous by default: give them a concise `aria-label` and a tooltip via the shared `@quietr/ui` wrapper unless there is a stronger established pattern in the same surface.
12. Prefer object syntax in `cn(...)` and `className` composition for conditional classes. Rewrite patterns like `condition && "class"` or `condition ? "class-a" : "class-b"` to object entries such as `{ "class": condition }` and `{ "class-a": condition, "class-b": !condition }`.
13. Inline simple one-off UI logic where practical. Prefer colocated TanStack Form schemas, string normalization, and submit/input handlers inside the owning component instead of extracting helper utilities or wrapper abstractions when the logic is only used once, even if that duplicates a small amount of code.
