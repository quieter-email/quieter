# quietr

`quietr` is a Bun + Turbo monorepo with a Next.js app and shared packages for auth, database, tRPC, and UI.

## Tech stack

- Runtime and package manager: Bun
- Monorepo orchestration: Turborepo
- App framework: Next.js App Router + React
- Forms: TanStack Form
- Keyboard shortcuts: TanStack Hotkeys
- URL query state: nuqs
- Theme management: next-themes
- API layer: tRPC v11 + `@trpc/tanstack-react-query`
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

- `apps/web`: Next.js app
  - `src/app/layout.tsx`: root HTML shell and client providers
  - `src/app/page.tsx`: authenticated inbox route; server-loads the session, redirects to the blocking Google scope-repair page for the exact broken mailbox when needed, and then hydrates the client workspace
  - `src/app/google-scope-repair/page.tsx`: blocking Google scope-repair page that names the affected mailbox and routes the user back through targeted relinking
  - `src/app/auth/page.tsx`: legacy auth route that redirects to `/login`
  - `src/app/home/page.tsx`: public landing route that redirects authenticated users to the inbox
  - `src/app/login/page.tsx`: public login route for magic link, Google, and passkey sign-in
  - `src/app/signup/page.tsx`: public signup route for magic link registration plus Google and passkey entry points
  - `src/app/settings/page.tsx`: authenticated settings route with server-side session guard
  - `src/app/api/trpc/[...path]/route.ts`: tRPC HTTP endpoint (includes auth email preview and user-status helpers used by login/signup)
  - `src/app/api/auth/[...all]/route.ts`: Better Auth Next.js route handler
  - `src/app/api/auth/google-scope-repair/route.ts`: server-side Google OAuth scope repair endpoint that starts targeted Better Auth relinking, hints the affected Google account, and preserves OAuth state cookies
  - `src/lib/trpc.ts`: shared raw tRPC client plus TanStack Query tRPC context helpers for the app
  - `src/lib/server-auth.ts`: cached server-side session helpers, redirects, and blocking Google-scope repair target helpers
  - `src/lib/google-scope-repair.ts`: shared app-side helpers for canonical Google scope-repair URLs and safe return paths
  - `src/lib/query-client.ts`: shared React Query client factory
  - `src/lib/query-persister.ts`: shared TanStack query persistence helpers with eager browser-cache restore, manual cache writes, and persister-backed cache removal
  - `src/lib/search-params.ts`: shared nuqs parsers/loaders/serializers for mailbox selection, mailbox folders, message, and search URL state, including the Drafts and Spam mailboxes
  - `src/lib/auth.ts`: Better Auth React client wrapper
  - `src/lib/errors.ts`: shared client-side helpers for turning provider, auth, tRPC, and JSON-shaped failures into user-facing messages
  - `src/lib/gmail/compose.ts`: compose state, Gmail draft hydration, attachment runtime handling, and send/delete helpers through tRPC
  - `src/lib/gmail/compose-query.ts`: persisted compose session query keys scoped by `mailboxId`
  - `src/lib/gmail/attachments.ts`: on-demand Gmail attachment download helpers used by mail detail surfaces
  - `src/lib/gmail/inbox-query.ts`: mailbox-scoped inbox query keys, Gmail-search-aware list loading, history-based live sync for unfiltered views, optimistic single-message actions, mailto-based unsubscribe actions, and thread-aware mailbox action helpers used by bulk selection
  - `src/lib/gmail/thread-query.ts`: thread query options
  - `src/lib/gmail/labels-query.ts`: Gmail label query options used by message actions
  - `src/lib/mailboxes-query.ts`: active-organization mailbox query options used by the inbox shell and settings
  - `src/components/providers.tsx`: client providers for next-themes, React Query, and the tRPC TanStack context
  - `src/components/mailbox-workspace.tsx`: interactive inbox shell using React Query, nuqs URL state, active-organization mailbox selection, Gmail search queries, compose/message state, and bulk mailbox action handlers
  - `src/components/auth-screen.tsx`: auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and tRPC auth lookups
  - `src/components/settings-screen.tsx`: settings shell that wires tab state, session data, and the settings panels
  - `src/components/settings/*.tsx`: modular settings sidebar, panels, account dialogs, and the personal-mailbox management panel
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose
  - `src/components/mail-sidebar.tsx`: user profile, connected mailbox switcher, and mailbox-folder navigation, including Inbox, Drafts, Spam, Sent, and Trash
- `packages/auth`: Better Auth server configuration
  - `src/index.ts`: Better Auth config with Google OAuth, passkeys, magic links, linked-account support for multiple Google accounts, personal-organization repair, email-change verification placeholders, account deletion, and Next.js cookies
  - `src/organization.ts`: helpers for guaranteeing a personal organization per user and keeping `activeOrganizationId` valid
  - `src/email-placeholder.ts`: in-memory placeholder store for magic-link and verification URLs
  - `src/google-scopes.ts`: required Google scopes for Gmail access
- `packages/database`: Drizzle schema, client, and migrations
  - `src/schema.ts`: auth tables, organizations, invitations, memberships, passkeys, and first-class mailbox records
  - `src/client.ts`: Neon + Drizzle client
  - `drizzle.config.ts`: Drizzle Kit config
- `packages/trpc`: shared tRPC router, context, server handler, and client
  - `src/compose.ts`: shared compose schemas plus robust mail-address parsing used by both the web app and Gmail draft mutations
  - `src/router.ts`: auth lookup procedures plus mailbox-scoped mail procedures for mailbox listing/sync, Gmail list/search procedures, Drafts listing/loading, mailbox history sync procedures, message actions, mailto-based unsubscribe sending, and thread-level mailbox mutations used by bulk selection
  - `src/mailbox-service.ts`: mailbox ownership, personal Gmail mailbox sync, authorization, and disconnect helpers
  - `src/gmail-service.ts`: shared Gmail API helpers and response typing used by the router and web app, including raw Gmail `q` filtering, Gmail system-label mailbox mapping, Gmail Drafts API helpers, `List-Unsubscribe` mailto parsing, and thread-level Gmail mutations
  - `src/server.ts`: `fetchRequestHandler` wrapper
  - `src/client.ts`: typed `createTrpcClient`
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
- Shared or managed organization mailboxes are not implemented yet. The only supported provider in v1 is personal Gmail connected through linked Google accounts.

## Architecture flow

1. `apps/web` uses `@quietr/trpc` through the shared raw client and TanStack Query tRPC context in `src/lib/trpc.ts`.
2. Browser requests hit `apps/web/src/app/api/trpc/[...path]/route.ts`.
3. `@quietr/trpc/server` handles requests through the shared router.
4. Browser-side TanStack Query persistence restores mailbox state before network sync, while tRPC talks directly to Gmail for deltas, reloads, and mutations. Manual refreshes for unfiltered mailbox views now walk Gmail history to completion, reconcile all loaded cached rows by message id, and only fall back to a broader page reload when Gmail history can no longer describe the delta.
5. The inbox shell first resolves the active organization's mailbox list, keeps `mailboxId` in the URL, and only issues Gmail API calls for the selected mailbox.
6. Auth form preflight checks such as email-status and placeholder preview lookups run through tRPC query options instead of manual client `fetch` calls.

## TanStack conventions

- Use TanStack Query first for app-owned async UI state in React code, with named `queryOptions(...)` and `mutationOptions(...)` instead of inline config objects.
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
- Gmail REST calls are centralized server-side in `packages/trpc/src/gmail-service.ts`, with access tokens resolved from the selected mailbox's linked Google account through Better Auth.
- Bulk mailbox actions operate on the loaded row set in the current mailbox and use thread-level Gmail mutations for conversation views.
- Compose state is persisted locally per mailbox while draft content and attachments are synced to Gmail drafts through tRPC-backed Gmail draft APIs.
- Opening a saved draft hydrates the Gmail draft payload and attachment files back into the compose dialog so Drafts behaves like a resumable mailbox, not just a local draft shortcut.
- `New Mail` always opens a fresh blank draft; previous unsent work remains resumable through the compose dialog's `Continue last draft` affordance.

## Next.js routing notes

- `apps/web/src/app/layout.tsx` owns the root providers and global shell concerns.
- Prefer App Router server components for auth checks and initial data loading. The inbox route currently uses `requireSession()` before handing off to client components.
- Keep interactive stateful surfaces as client components, especially React Query consumers, compose flows, and search-param state.
- Catch-all API handlers live under `src/app/api/**/route.ts`.

## Getting started

```bash
bun install
bun run db:push
bun run dev
```

Open `http://localhost:3000`.

## Root commands

```bash
bun run dev
bun run lint
bun run lint:fix
bun run fmt
bun run fmt:check
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
- Outbound auth email delivery is not configured in this repo yet. Magic links and email-change verification currently use local placeholder previews instead of real email sends.
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY`: Logo.dev publishable key used for sender avatars
- `VITE_LOGO_DEV_PUBLISHABLE_KEY`: backward-compatible fallback mapped by `apps/web/next.config.ts`

## Dependency management

- Root `package.json` uses Bun workspaces and `workspaces.catalog` for version pinning.
- Root `package.json` also mirrors the React/Next entries in a top-level `catalog` field so external tooling that does not understand `workspaces.catalog` can still detect the app stack.
- Workspace packages consume shared versions via `catalog:` references.
