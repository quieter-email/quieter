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
  - `src/app/page.tsx`: authenticated inbox route; server-loads the session before hydrating the client workspace
  - `src/app/auth/page.tsx`: legacy auth route that redirects to `/login`
  - `src/app/home/page.tsx`: public landing route that redirects authenticated users to the inbox
  - `src/app/login/page.tsx`: public login route for magic link, Google, and passkey sign-in
  - `src/app/signup/page.tsx`: public signup route for magic link registration plus Google and passkey entry points
  - `src/app/settings/page.tsx`: authenticated settings route with server-side session guard
  - `src/app/api/trpc/[...path]/route.ts`: tRPC HTTP endpoint (includes auth email preview and user-status helpers used by login/signup)
  - `src/app/api/auth/[...all]/route.ts`: Better Auth Next.js route handler
  - `src/lib/trpc.ts`: shared raw tRPC client plus TanStack Query tRPC context helpers for the app
  - `src/lib/server-auth.ts`: cached server-side session helpers and redirects
  - `src/lib/query-client.ts`: shared React Query client factory
  - `src/lib/query-persister.ts`: shared TanStack query persistence helpers with eager browser-cache restore
  - `src/lib/search-params.ts`: shared nuqs parsers/loaders/serializers for mailbox, message, and search URL state, including the Drafts and Spam mailboxes
  - `src/lib/auth.ts`: Better Auth React client wrapper
  - `src/lib/errors.ts`: shared client-side helpers for turning provider, auth, tRPC, and JSON-shaped failures into user-facing messages
  - `src/lib/gmail/compose.ts`: compose state, Gmail draft hydration, attachment runtime handling, and send/delete helpers through tRPC
  - `src/lib/gmail/compose-query.ts`: persisted compose session query keys scoped by `userId`
  - `src/lib/gmail/attachments.ts`: on-demand Gmail attachment download helpers used by mail detail surfaces
  - `src/lib/gmail/inbox-query.ts`: inbox query keys, Gmail-search-aware list loading, history-based live sync for unfiltered views, optimistic single-message actions, and thread-aware mailbox action helpers used by bulk selection
  - `src/lib/gmail/thread-query.ts`: thread query options
  - `src/lib/gmail/labels-query.ts`: Gmail label query options used by message actions
  - `src/components/providers.tsx`: client providers for next-themes, React Query, and the tRPC TanStack context
  - `src/components/mailbox-workspace.tsx`: interactive inbox shell using React Query, nuqs URL state, Gmail search queries, compose/message state, and bulk mailbox action handlers
  - `src/components/auth-screen.tsx`: auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and tRPC auth lookups
  - `src/components/settings-screen.tsx`: settings shell that wires tab state, session data, and the settings panels
  - `src/components/settings/*.tsx`: modular settings sidebar, panels, and account dialogs
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose
  - `src/components/mail-sidebar.tsx`: user profile and mailbox-folder navigation, including Inbox, Drafts, Spam, Sent, and Trash
- `packages/auth`: Better Auth server configuration
  - `src/index.ts`: Better Auth config with Google OAuth, passkeys, magic links, Better Auth's organization plugin, email-change verification placeholders, account deletion, and Next.js cookies
  - `src/email-placeholder.ts`: in-memory placeholder store for magic-link and verification URLs
  - `src/google-scopes.ts`: required Google scopes for Gmail access
- `packages/database`: Drizzle schema, client, and migrations
  - `src/schema.ts`: auth tables, organizations, invitations, memberships, and passkeys
  - `src/client.ts`: Neon + Drizzle client
  - `drizzle.config.ts`: Drizzle Kit config
- `packages/trpc`: shared tRPC router, context, server handler, and client
  - `src/compose.ts`: shared compose schemas plus robust mail-address parsing used by both the web app and Gmail draft mutations
  - `src/router.ts`: auth lookup procedures plus user-scoped Gmail list/search procedures, Drafts listing/loading, mailbox history sync procedures, message actions, and thread-level mailbox mutations used by bulk selection
  - `src/gmail-service.ts`: shared Gmail API helpers and response typing used by the router and web app, including raw Gmail `q` filtering, Gmail system-label mailbox mapping, Gmail Drafts API helpers, and thread-level Gmail mutations
  - `src/server.ts`: `fetchRequestHandler` wrapper
  - `src/client.ts`: typed `createTrpcClient`
- `packages/ui`: shared Tailwind theme, next-themes wrapper, styled UI components built on Base UI, Vaul, and Sonner, plus the shared icon-button tooltip wrapper for icon-only controls
- `packages/config`: shared TypeScript config package

## Product shape

- Quietr is a simple Gmail client again.
- The signed-in user is the center of the app.
- Organizations are managed directly through Better Auth's organization plugin. Users can belong to zero or more organizations, and the active organization stays empty until the user selects one or accepts an invitation.
- A single Google auth flow grants the profile and Gmail scopes needed for reading, drafting, sending, and message actions.
- Quietr supports Google, magic-link, and passkey sign-in.
- Inbox views support row selection with mailbox-aware bulk actions for loaded conversations and drafts, including avatar-slot selection, Shift range selection, Ctrl/Cmd toggles, and `Mod+A` / `Escape` list hotkeys.
- Outbound auth email delivery is not configured yet, so magic links and email verification URLs are exposed through local placeholder endpoints during development.
- Organizations currently provide account/settings structure only. There is still no shared-mailbox or mailbox-connection model in the current implementation.

## Architecture flow

1. `apps/web` uses `@quietr/trpc` through the shared raw client and TanStack Query tRPC context in `src/lib/trpc.ts`.
2. Browser requests hit `apps/web/src/app/api/trpc/[...path]/route.ts`.
3. `@quietr/trpc/server` handles requests through the shared router.
4. Browser-side TanStack Query persistence restores mailbox state before network sync, while tRPC talks directly to Gmail for deltas, reloads, and mutations. Manual refreshes for unfiltered mailbox views now walk Gmail history to completion, reconcile all loaded cached rows by message id, and only fall back to a broader page reload when Gmail history can no longer describe the delta.
5. Auth form preflight checks such as email-status and placeholder preview lookups run through tRPC query options instead of manual client `fetch` calls.

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
- Gmail REST calls are centralized server-side in `packages/trpc/src/gmail-service.ts`, with access tokens resolved from the signed-in user's linked Google account.
- Bulk mailbox actions operate on the loaded row set in the current mailbox and use thread-level Gmail mutations for conversation views.
- Compose state is persisted locally per user while draft content and attachments are synced to Gmail drafts through tRPC-backed Gmail draft APIs.
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
