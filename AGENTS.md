# Agent Guide - quietr

Welcome! This guide is intended to get any AI agent or developer productive in the `quietr` monorepo quickly.

## Tech Stack

- Runtime and package manager: [Bun](https://bun.sh/)
- Monorepo orchestration: [Turborepo](https://turbo.build/repo)
- Frontend app: [Next.js](https://nextjs.org/) App Router + [React](https://react.dev/)
- Forms: [TanStack Form](https://tanstack.com/form/latest)
- Keyboard shortcuts: [TanStack Hotkeys](https://tanstack.com/hotkeys/latest)
- Routing: `src/app/**` App Router segments with `page.tsx`, `layout.tsx`, and `route.ts`
- URL query state: [nuqs](https://nuqs.dev/)
- Theme management: [next-themes](https://github.com/pacocoursey/next-themes)
- API layer: [tRPC v11](https://trpc.io/) + [`@trpc/tanstack-react-query`](https://trpc.io/docs/client/tanstack-react-query)
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

- `apps/web/`: Next.js App Router application.
  - `src/app/layout.tsx`: Root HTML shell and client providers.
  - `src/app/page.tsx`: Authenticated inbox route that server-loads the session before hydrating the client workspace.
  - `src/app/auth/page.tsx`: Legacy auth route that redirects to `/login`.
  - `src/app/home/page.tsx`: Public landing route that redirects authenticated users away.
  - `src/app/login/page.tsx`: Public login route for magic-link, Google, and passkey sign-in.
  - `src/app/signup/page.tsx`: Public signup route for magic-link registration plus Google and passkey entry points.
  - `src/app/settings/page.tsx`: Authenticated settings route with server-side guard.
  - `src/app/api/trpc/[...path]/route.ts`: HTTP endpoint for tRPC requests (`/api/trpc`), including auth email preview and user-status helpers for login/signup.
  - `src/app/api/auth/[...all]/route.ts`: Better Auth route handler.
  - `src/lib/trpc.ts`: Shared raw tRPC client plus TanStack Query tRPC context helpers for the app.
  - `src/lib/server-auth.ts`: Cached server-side session helpers and redirects.
  - `src/lib/query-client.ts`: Shared React Query client factory.
  - `src/lib/query-persister.ts`: Shared TanStack query persister helpers for eager browser-cache restore, manual cache writes, and persister-backed cache removal.
  - `src/lib/search-params.ts`: Shared nuqs parsers/loaders/serializers for app URL state, including mailbox search queries and the Drafts and Spam mailboxes.
  - `src/lib/auth.ts`: Better Auth React client wrapper.
  - `src/lib/errors.ts`: Shared client-side helpers for turning auth, tRPC, provider, and JSON-shaped failures into user-facing messages.
  - `src/lib/gmail/compose.ts`: User-scoped Gmail draft hydration helpers, attachment runtime store, and compose state types.
  - `src/lib/gmail/compose-query.ts`: Persisted compose session query keys keyed by user id.
  - `src/lib/gmail/attachments.ts`: On-demand Gmail attachment download helpers for mail detail surfaces.
  - `src/lib/gmail/inbox-query.ts`: User-scoped inbox query keys, Gmail-search-aware loading, history-based sync helpers for unfiltered views, optimistic message actions, mailto-based unsubscribe actions, and thread-aware mailbox action helpers used by bulk selection.
  - `src/lib/gmail/thread-query.ts`: Thread query helpers.
  - `src/lib/gmail/labels-query.ts`: Shared `queryOptions(...)` helpers for Gmail label metadata.
  - `src/components/providers.tsx`: Client-side next-themes, React Query, and tRPC TanStack providers.
  - `src/components/mailbox-workspace.tsx`: Interactive inbox shell, search-param state, Gmail search queries, message panes, compose modal, and bulk mailbox action handlers.
  - `src/components/auth-screen.tsx`: Client auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and tRPC auth lookups.
  - `src/components/settings-screen.tsx`: Client settings shell that wires tab state, session data, and the settings panels.
  - `src/components/settings/*.tsx`: Modular settings sidebar, panels, and account dialogs.
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance.
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose.
  - `src/components/mail-sidebar.tsx`: Sidebar showing the current user profile and mailbox-folder navigation across Inbox, Drafts, Spam, Sent, and Trash.
- `packages/auth/`: Better Auth server package.
  - `src/index.ts`: Better Auth configuration with Google OAuth, passkeys, magic links, Better Auth's organization plugin, email-change verification placeholders, account deletion, and Next.js cookies. `baseURL` is `BETTER_AUTH_URL` when set, else `https://${VERCEL_URL}` when set, else `http://localhost:3000`.
  - `src/email-placeholder.ts`: In-memory placeholder store for magic-link and verification URLs.
  - `src/google-scopes.ts`: Required Google OAuth scopes.
- `packages/database/`: Shared database package.
  - `src/schema.ts`: Drizzle schema definitions for auth, organizations, invitations, memberships, and passkeys.
  - `src/client.ts`: Neon and Drizzle client setup.
  - `drizzle.config.ts`: Drizzle Kit configuration.
- `packages/trpc/`: Shared API contract + server/client helpers.
  - `src/compose.ts`: Shared compose schemas plus robust mail-address parsing used by both the web app and Gmail draft mutations.
  - `src/context.ts`: tRPC context creation.
  - `src/router.ts`: App router with auth lookup procedures plus user-scoped Gmail operations, list/search procedures, Drafts listing/loading, mailbox history sync procedures, mailto-based unsubscribe sending, and thread-level mailbox mutations used by bulk selection.
  - `src/gmail-service.ts`: Shared Gmail response typing plus batched Gmail API helpers used by tRPC, including raw Gmail `q` filtering, Gmail Drafts API helpers, `List-Unsubscribe` mailto parsing, and thread-level Gmail mutations.
  - `src/server.ts`: `fetchRequestHandler` integration.
  - `src/client.ts`: Typed client factory.
  - `src/types.ts`: `RouterInputs` and `RouterOutputs` utility types.
- `packages/ui/`: Shared UI package with the Tailwind theme, next-themes wrapper, styled component wrappers built on Base UI, Vaul, and Sonner, plus the shared icon-button tooltip wrapper for icon-only controls.
- `packages/config/`: Shared TypeScript config package.

## Core Concepts and Patterns

### Product model

- Quietr is a straightforward Gmail client.
- The signed-in user is the center of the app.
- Organizations are managed directly through Better Auth's organization plugin. Users can belong to zero or more organizations, and the active organization stays empty until the user selects one or accepts an invitation.
- Organizations currently support account/settings structure only. There is still no shared-mailbox or mailbox-connection model in the current implementation.
- Google sign-in directly requests the Gmail scopes needed for inbox access, drafting, sending, and message actions.
- When Gmail exposes a `List-Unsubscribe` mailto target, message menus expose a single unsubscribe action that auto-sends the unsubscribe email through the signed-in account.
- Passkeys are optional secondary sign-in credentials that can be added from settings after the user signs in with Google or magic link.
- Outbound auth email delivery is not configured right now, so magic links and email verification flows use local placeholder previews instead of real email sends.
- Inbox list views support row selection with mailbox-aware bulk actions for loaded conversations and drafts, including avatar-slot selection, Shift range selection, Ctrl/Cmd toggles, and `Mod+A` / `Escape` list hotkeys.

### Monorepo boundaries

- `apps/web` should consume shared functionality via package imports (`@quietr/trpc`, `@quietr/config`).
- `apps/*` should consume reusable UI through `@quietr/ui`; do not import Base UI, Vaul, or Sonner directly in app code unless `packages/ui` is being extended in the same change.
- `packages/trpc` is the boundary between app and database logic.
- `packages/database` should own schema and migration concerns.
- `packages/auth` owns Better Auth configuration.
- Icon-only interactive controls should use the shared tooltip wrapper from `@quietr/ui`, keep a concise `aria-label`, and stay visually compact.

### TanStack Query and mutationOptions

- Use TanStack Query first for app-owned async UI state in React code.
- Use named `queryOptions(...)` and `mutationOptions(...)` when:
  - A query or mutation config is needed in more than one place.
  - You want a single source of truth for query keys, mutation keys, or cache behavior.
- Prefer extracting shared query and mutation options into colocated `*-query.ts` modules when they are reused.
- Pass the result of `queryOptions(...)` directly to `useQuery`, `prefetchQuery`, or other query methods, and pass the result of `mutationOptions(...)` to `useMutation(...)`; avoid duplicating keys or config inline.
- Keep Better Auth's native reactive hooks as the source of truth for auth-owned state such as `useSession`, `useActiveOrganization`, `useListOrganizations`, and `useListPasskeys`.
- In non-hook code, prefer query-client reads when shared caching matters, but call the underlying client directly for one-off writes when TanStack would only add indirection.
- User-scoped data must include `userId` in its query keys so persisted browser caches do not bleed across accounts.

### API and data flow

- App calls `@quietr/trpc` from `apps/web/src/lib/trpc.ts` through the shared raw client and TanStack Query tRPC context.
- Requests are handled in `apps/web/src/app/api/trpc/[...path]/route.ts` using `@quietr/trpc/server`.
- Router procedures cover auth email-status/preview lookups plus Gmail list/thread/history-sync/label/draft/attachment/message actions, including Drafts listing/loading and Spam/Not Spam flows.
- Mailbox list queries can forward raw Gmail advanced-search syntax through the Gmail API `q` parameter while still applying the selected mailbox label, including Drafts and Spam.
- Browser-side TanStack Query persistence is the primary Gmail cache and is restored before inbox queries mount.
- User-scoped Gmail and auth-adjacent read models must include `userId` in their query keys so persisted browser caches stay isolated per signed-in account.
- Sender avatars are derived at request time from the message sender and are not persisted in Postgres.
- Manual `queryClient.setQueryData` writes are persisted with `persistQueryByKey` so optimistic cache updates survive reloads.
- Gmail REST calls are executed server-side in `packages/trpc/src/gmail-service.ts`, with access tokens resolved from the signed-in user's linked Google account.
- Bulk mailbox actions operate on the loaded row set in the current mailbox and use thread-level Gmail mutations for conversation views.
- Mailbox freshness uses Gmail history IDs, so background polling only reloads loaded pages when Gmail reports a relevant change.
- Manual refreshes for unfiltered mailbox views now walk Gmail history deltas to completion, reconcile loaded cached rows by message id, and only fall back to a broader page reload when Gmail history can no longer describe the mailbox state.
- Loaded mailbox rows are no longer gated by a fixed loaded-message sync cutoff; Gmail history deltas are intersected against the full cached mailbox window on the client.
- Message-list viewport prefetch is intentionally capped to one extra page on mount so tall windows do not chain-load many pages before the user scrolls.
- Filtered search views and the Drafts mailbox are refreshed manually instead of participating in history-based live sync.
- Thread bodies and non-inline attachment metadata are still fetched on demand from Gmail.
- Compose state is a browser-local persisted session keyed by user id; draft content and attachments are synced to Gmail drafts via tRPC procedures, and reopening saved drafts hydrates Gmail-backed attachment files back into compose state.

### Routing + SSR behavior

- `apps/web/src/app/layout.tsx` owns root-level providers, global styles, and the app shell.
- Prefer server components for auth guards and initial data loading. Use `requireSession` and `redirectIfAuthenticated` before handing off to client components.
- Keep API handlers under `apps/web/src/app/api/**/route.ts`.
- Use client components for React Query, compose flows, and search-param-driven inbox state.

### Database and migrations

- Schema changes go in `packages/database/src/schema.ts`.
- Use `bun run db:push` for local schema changes by default.
- Generate migrations with `bun run db:generate` and apply them with `bun run db:migrate` only when migration files are explicitly needed.
- Database connections use `DATABASE_URL`.

### Shared tooling and config

- Each workspace package has its own scripts and dev dependencies for `oxlint`, `oxfmt`, and `tsgo`.
- Shared TypeScript config is in `packages/config`, while Oxlint/Oxfmt config is at repo root.
- Root `package.json` keeps Bun versions in `workspaces.catalog` and mirrors the React/Next entries in a top-level `catalog` field for external tooling compatibility.
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY` is used for sender avatars in the inbox UI.
- `VITE_LOGO_DEV_PUBLISHABLE_KEY` remains a backward-compatible fallback mapped through `apps/web/next.config.ts`.
- Outbound auth email delivery is not configured in this repo right now, so magic links and email verification flows rely on placeholder previews during local development.

### Generated files

- Do not hand-edit generated Drizzle migration snapshots unless intentionally repairing generated output.

## Development Workflow

Root commands:

- `bun install`
- `bun run dev`
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
2. Preserve package boundaries: avoid direct app-to-database coupling; route through `@quietr/trpc`.
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
