# quietr

`quietr` is a Bun + Turbo monorepo with a Next.js app and shared packages for auth, database, tRPC, and UI.

## Tech stack

- Runtime and package manager: Bun
- Monorepo orchestration: Turborepo
- App framework: Next.js App Router + React
- URL query state: nuqs
- Theme management: next-themes
- API layer: tRPC v11
- Database layer: Drizzle ORM beta + Postgres (Neon HTTP)
- Styling: Tailwind CSS v4
- UI primitives: Base UI
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
  - `src/app/api/trpc/[...path]/route.ts`: tRPC HTTP endpoint
  - `src/app/api/auth/[...all]/route.ts`: Better Auth Next.js route handler
  - `src/app/api/auth-email-preview/route.ts`: placeholder auth-email preview endpoint for magic-link and verification URLs during local development
  - `src/app/api/auth-user-status/route.ts`: email existence lookup used to keep login and signup flows distinct
  - `src/lib/trpc.ts`: shared tRPC client instance for the app
  - `src/lib/server-auth.ts`: cached server-side session helpers and redirects
  - `src/lib/query-client.ts`: shared React Query client factory
  - `src/lib/query-persister.ts`: shared TanStack query persistence helpers
  - `src/lib/search-params.ts`: shared nuqs parsers/loaders/serializers for URL state
  - `src/lib/auth.ts`: Better Auth React client wrapper
  - `src/lib/gmail/compose.ts`: compose state, draft hydration, attachment runtime handling, and send/delete helpers through tRPC
  - `src/lib/gmail/compose-query.ts`: persisted compose session query keys scoped by `userId`
  - `src/lib/gmail/inbox-query.ts`: inbox query keys, live sync, and optimistic message action helpers
  - `src/lib/gmail/thread-query.ts`: thread query options
  - `src/lib/gmail/labels-query.ts`: Gmail label query options used by message actions
  - `src/components/providers.tsx`: client providers for next-themes and React Query
  - `src/components/mailbox-workspace.tsx`: interactive inbox shell using React Query, nuqs URL state, and compose/message state
  - `src/components/auth-screen.tsx`: minimal auth UI for separate login/signup routes, magic-link placeholders, Google, and passkeys
  - `src/components/settings-screen.tsx`: settings UI for theme, account profile, passkeys, sign-out, account deletion, and placeholder email-change verification
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose
  - `src/components/mail-sidebar.tsx`: user profile and mailbox-folder navigation
- `packages/auth`: Better Auth server configuration
  - `src/index.ts`: Better Auth config with Google OAuth, passkeys, magic links, email-change verification placeholders, account deletion, and Next.js cookies
  - `src/email-placeholder.ts`: in-memory placeholder store for magic-link and verification URLs
  - `src/google-scopes.ts`: required Google scopes for Gmail access
- `packages/database`: Drizzle schema, client, and migrations
  - `src/schema.ts`: auth tables, passkeys, and Gmail message metadata cache/state tables keyed by `userId`
  - `src/client.ts`: Neon + Drizzle client
  - `drizzle.config.ts`: Drizzle Kit config
- `packages/trpc`: shared tRPC router, context, server handler, and client
  - `src/router.ts`: user-scoped Gmail procedures plus Gmail metadata cache procedures
  - `src/gmail-service.ts`: shared Gmail API helpers and response typing used by the router and web app
  - `src/server.ts`: `fetchRequestHandler` wrapper
  - `src/client.ts`: typed `createTrpcClient`
- `packages/ui`: shared Tailwind theme, next-themes wrapper, and UI components
- `packages/config`: shared TypeScript config package

## Product shape

- Quietr is a simple Gmail client again.
- The signed-in user is the center of the app.
- A single Google auth flow grants the profile and Gmail scopes needed for reading, drafting, sending, and message actions.
- Quietr supports Google, magic-link, and passkey sign-in.
- Outbound auth email delivery is not configured yet, so magic links and email verification URLs are exposed through local placeholder endpoints during development.
- There is no organization, shared-mailbox, or mailbox-connection model in the current implementation.

## Architecture flow

1. `apps/web` uses `@quietr/trpc` client in `src/lib/trpc.ts`.
2. Browser requests hit `apps/web/src/app/api/trpc/[...path]/route.ts`.
3. `@quietr/trpc/server` handles requests through the shared router.
4. `@quietr/database` persists lightweight Gmail message metadata in Postgres via `DATABASE_URL`.

## Inbox sync strategy

- Inbox list data is cached with TanStack Query and persisted in `localStorage` for fast reloads.
- Freshness uses periodic polling plus manual refresh.
- Polling is list-first: compare message IDs from Gmail, then fetch metadata only for unseen IDs.
- Message metadata is also persisted server-side in Postgres per user through tRPC so repeated metadata calls are reduced across sessions.
- Sender avatars are derived at request time from the message sender and are not stored in Postgres.
- Thread bodies are fetched on click for fast navigation with minimal background API usage.
- Manual `queryClient.setQueryData` updates are immediately written to local persistence via `persistQueryByKey` so optimistic UI changes survive reloads.
- Gmail REST calls are centralized server-side in `packages/trpc/src/gmail-service.ts`, with access tokens resolved from the signed-in user's linked Google account.
- Compose state is persisted locally per user while draft content and attachments are synced to Gmail drafts through tRPC-backed Gmail draft APIs.
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
- `BETTER_AUTH_SECRET`: Better Auth secret
- Outbound auth email delivery is not configured in this repo yet. Magic links and email-change verification currently use local placeholder previews instead of real email sends.
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY`: Logo.dev publishable key used for sender avatars
- `VITE_LOGO_DEV_PUBLISHABLE_KEY`: backward-compatible fallback mapped by `apps/web/next.config.ts`

## Dependency management

- Root `package.json` uses Bun workspaces and `workspaces.catalog` for version pinning.
- Workspace packages consume shared versions via `catalog:` references.
