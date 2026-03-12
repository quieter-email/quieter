# Agent Guide - quietr

Welcome! This guide is intended to get any AI agent or developer productive in the `quietr` monorepo quickly.

## Tech Stack

- Runtime and package manager: [Bun](https://bun.sh/)
- Monorepo orchestration: [Turborepo](https://turbo.build/repo)
- Frontend app: [Next.js](https://nextjs.org/) App Router + [React](https://react.dev/)
- Forms: [TanStack Form](https://tanstack.com/form/latest)
- Routing: `src/app/**` App Router segments with `page.tsx`, `layout.tsx`, and `route.ts`
- URL query state: [nuqs](https://nuqs.dev/)
- Theme management: [next-themes](https://github.com/pacocoursey/next-themes)
- API layer: [tRPC v11](https://trpc.io/) + [`@trpc/tanstack-react-query`](https://trpc.io/docs/client/tanstack-react-query)
- Database: [Drizzle ORM beta](https://orm.drizzle.team/) + Postgres (Neon HTTP)
- Styling: [Tailwind CSS 4](https://tailwindcss.com/)
- UI primitives: [Base UI](https://base-ui.com/)
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
  - `src/app/api/trpc/[...path]/route.ts`: HTTP endpoint for tRPC requests (`/api/trpc`).
  - `src/app/api/auth/[...all]/route.ts`: Better Auth route handler.
  - `src/app/api/auth-email-preview/route.ts`: Placeholder auth-email preview endpoint for magic-link and verification URLs during local development.
  - `src/app/api/auth-user-status/route.ts`: Email existence lookup used to keep login and signup flows distinct.
  - `src/lib/trpc.ts`: Shared raw tRPC client plus TanStack Query tRPC context helpers for the app.
  - `src/lib/server-auth.ts`: Cached server-side session helpers and redirects.
  - `src/lib/query-client.ts`: Shared React Query client factory.
  - `src/lib/query-persister.ts`: Shared TanStack query persister helpers for eager browser-cache restore and manual cache writes.
  - `src/lib/search-params.ts`: Shared nuqs parsers/loaders/serializers for app URL state.
  - `src/lib/auth.ts`: Better Auth React client wrapper.
  - `src/lib/gmail/compose.ts`: User-scoped draft hydration helpers, attachment runtime store, and compose state types.
  - `src/lib/gmail/compose-query.ts`: Persisted compose session query keys keyed by user id.
  - `src/lib/gmail/attachments.ts`: On-demand Gmail attachment download helpers for mail detail surfaces.
  - `src/lib/gmail/inbox-query.ts`: User-scoped inbox query keys, history-based sync helpers, and optimistic message actions.
  - `src/lib/gmail/thread-query.ts`: Thread query helpers.
  - `src/lib/gmail/labels-query.ts`: Shared `queryOptions(...)` helpers for Gmail label metadata.
  - `src/components/providers.tsx`: Client-side next-themes, React Query, and tRPC TanStack providers.
  - `src/components/mailbox-workspace.tsx`: Interactive inbox shell, search-param state, message panes, and compose modal.
  - `src/components/auth-screen.tsx`: Client auth UI for separate login/signup routes using TanStack Form, TanStack Query mutations, and tRPC auth lookups.
  - `src/components/settings-screen.tsx`: Client settings UI for theme, profile, passkeys, sign-out, account deletion, and placeholder email-change verification.
  - `src/components/compose-dialog.tsx`: `New Mail` modal with autosave and continue-last-draft affordance.
  - `src/components/compose-editor.tsx`: Tiptap editor shell and toolbar used by compose.
  - `src/components/mail-sidebar.tsx`: Sidebar showing the current user profile and mailbox-folder navigation.
- `packages/auth/`: Better Auth server package.
  - `src/index.ts`: Better Auth configuration with Google OAuth, passkeys, magic links, email-change verification placeholders, account deletion, and Next.js cookies.
  - `src/email-placeholder.ts`: In-memory placeholder store for magic-link and verification URLs.
  - `src/google-scopes.ts`: Required Google OAuth scopes.
- `packages/database/`: Shared database package.
  - `src/schema.ts`: Drizzle schema definitions for auth and passkeys.
  - `src/client.ts`: Neon and Drizzle client setup.
  - `drizzle.config.ts`: Drizzle Kit configuration.
- `packages/trpc/`: Shared API contract + server/client helpers.
  - `src/context.ts`: tRPC context creation.
  - `src/router.ts`: App router with auth lookup procedures plus user-scoped Gmail operations and mailbox history sync procedures.
  - `src/gmail-service.ts`: Shared Gmail response typing plus batched Gmail API helpers used by tRPC.
  - `src/server.ts`: `fetchRequestHandler` integration.
  - `src/client.ts`: Typed client factory.
  - `src/types.ts`: `RouterInputs` and `RouterOutputs` utility types.
- `packages/ui/`: Shared UI package.
- `packages/config/`: Shared TypeScript config package.

## Core Concepts and Patterns

### Product model

- Quietr is a straightforward Gmail client.
- The signed-in user is the center of the app.
- There is no organization, shared-mailbox, or mailbox-connection model in the current implementation.
- Google sign-in directly requests the Gmail scopes needed for inbox access, drafting, sending, and message actions.
- Passkeys are optional secondary sign-in credentials that can be added from settings after the user signs in with Google or magic link.
- Outbound auth email delivery is not configured right now, so magic links and email verification flows use local placeholder previews instead of real email sends.

### Monorepo boundaries

- `apps/web` should consume shared functionality via package imports (`@quietr/trpc`, `@quietr/config`).
- `packages/trpc` is the boundary between app and database logic.
- `packages/database` should own schema and migration concerns.
- `packages/auth` owns Better Auth configuration.

### TanStack Query and queryOptions

- Use `queryOptions` (from `@tanstack/react-query`) when:
  - A query config is needed in more than one place.
  - You want a single source of truth for query keys and config.
- Prefer extracting query options into shared modules (e.g. `*-query.ts`) when used across components.
- Pass the result of `queryOptions(...)` directly to `useQuery`, `prefetchQuery`, or other query methods; avoid duplicating query keys or config inline.

### API and data flow

- App calls `@quietr/trpc` from `apps/web/src/lib/trpc.ts` through the shared raw client and TanStack Query tRPC context.
- Requests are handled in `apps/web/src/app/api/trpc/[...path]/route.ts` using `@quietr/trpc/server`.
- Router procedures cover auth email-status/preview lookups plus Gmail list/thread/history-sync/label/draft/attachment/message actions.
- Browser-side TanStack Query persistence is the primary Gmail cache and is restored before inbox queries mount.
- Sender avatars are derived at request time from the message sender and are not persisted in Postgres.
- Manual `queryClient.setQueryData` writes are persisted with `persistQueryByKey` so optimistic cache updates survive reloads.
- Gmail REST calls are executed server-side in `packages/trpc/src/gmail-service.ts`, with access tokens resolved from the signed-in user's linked Google account.
- Mailbox freshness uses Gmail history IDs, so background polling only reloads loaded pages when Gmail reports a relevant change.
- Thread bodies and non-inline attachment metadata are still fetched on demand from Gmail.
- Compose state is a browser-local persisted session keyed by user id; draft content and attachments are synced to Gmail drafts via tRPC procedures.

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
3. Keep type safety strict: avoid `any`; prefer inference and exported shared types.
4. Respect generated files: do not manually rewrite generated route tree or migration metadata without clear reason.
5. For schema changes, use `bun run db:push` by default and verify app behavior end-to-end; only generate/apply migrations when explicitly needed.
6. Before finishing work, run lint, fmt:check, typecheck, and build from repo root.
7. Use `queryOptions` when adding or refactoring TanStack Query usage.
8. Prioritize clarity in inbox surfaces and keep the workflow simple.
