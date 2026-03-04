# Agent Guide - quietr

Welcome! This guide is intended to get any AI agent or developer productive in the `quietr` monorepo quickly.

## Tech Stack

- Runtime and package manager: [Bun](https://bun.sh/)
- Monorepo orchestration: [Turborepo](https://turbo.build/repo)
- Frontend app: [SolidStart](https://docs.solidjs.com/solid-start) + [Vite](https://vite.dev/)
- Routing: `@solidjs/router` file-based routing via `@solidjs/start/router`
- API layer: [tRPC v11](https://trpc.io/)
- Database: [Drizzle ORM beta](https://orm.drizzle.team/) + Postgres (Neon HTTP)
- Styling: [Tailwind CSS 4](https://tailwindcss.com/)
- Linting and formatting: [Oxlint](https://oxc.rs/docs/guide/usage/linter) + [Oxfmt](https://oxc.rs/docs/guide/usage/formatter)
- Type checking: TypeScript native preview (`tsgo` from `@typescript/native-preview`)

## Project Structure

- `apps/web/`: SolidStart application.
  - `src/app.tsx`: Router setup, root shell, and global error boundary.
  - `src/entry-client.tsx`: Client entrypoint.
  - `src/entry-server.tsx`: Server entrypoint and HTML document shell.
  - `src/routes/index.tsx`: Minimal landing page scaffold.
  - `src/routes/api/trpc/[...path].ts`: HTTP endpoint for tRPC requests (`/api/trpc`).
  - `src/lib/trpc.ts`: Shared tRPC client instance for the app.
  - `src/lib/query-persister.ts`: Shared TanStack query persister helpers for manual cache writes.
  - `src/lib/google-api/client.ts`: Reusable typed Google API client + endpoint contract helpers.
  - `src/lib/gmail/gmail-api.ts`: Gmail endpoint contracts (path/query/schema) and typed wrappers.
- `packages/database/`: Shared database package.
  - `src/schema.ts`: Drizzle schema definitions.
  - `src/client.ts`: Neon and Drizzle client setup.
  - `drizzle.config.ts`: Drizzle Kit configuration.
  - `drizzle/`: Generated migration artifacts.
- `packages/trpc/`: Shared API contract + server/client helpers.
  - `src/context.ts`: tRPC context creation.
  - `src/router.ts`: App router with Gmail cache procedures.
  - `src/server.ts`: `fetchRequestHandler` integration.
  - `src/client.ts`: Typed client factory.
  - `src/types.ts`: `RouterInputs` and `RouterOutputs` utility types.
- `packages/ui/`: Shared UI package.
  - `src/styles.css`: Tailwind v4 tokens and global base styles.
  - `src/components/button.tsx`: Kobalte-based button primitive and variants.
  - `src/components/text-field.tsx`: Kobalte-based text field primitives.
  - `src/components/card.tsx`: Shared card/layout primitives.
  - `src/index.ts`: Package exports for all shared UI primitives.
- `packages/config/`: Shared TypeScript config package.
  - `tsconfig/base.json`: Shared TypeScript compiler baseline.
- `oxlint.json`: Root shared Oxlint config.
- `oxfmt.json`: Root shared Oxfmt config.

## Core Concepts and Patterns

### Monorepo boundaries

- `apps/web` should consume shared functionality via package imports (`@quietr/trpc`, `@quietr/config`).
- `packages/trpc` is the boundary between app and database logic.
- `packages/database` should own schema and migration concerns.

### TanStack Query and queryOptions

- Use `queryOptions` (from `@tanstack/solid-query`) when:
  - A query config is needed in more than one place (e.g. `useQuery` and `prefetchQuery`, or `getQueryData` / `invalidateQueries` / `cancelQueries`).
  - You want a single source of truth for query keys and config.
- Prefer extracting query options into shared modules (e.g. `*-query.ts`) when used across components.
- Examples: `apps/web/src/lib/gmail/thread-query.ts` defines `getThreadWithDetailsOptions(threadId)` for thread details; `apps/web/src/lib/gmail/inbox-query.ts` defines `messagesQueryOptions` and `liveSyncQueryOptions` for the inbox list and sync, used by `useInfiniteQuery`, `useQuery`, `cancelQueries`, and `getQueryData`/`setQueryData`.
- Pass the result of `queryOptions(...)` directly to `useQuery`, `prefetchQuery`, or other query methods; avoid duplicating query keys or config inline.

### API and data flow

- App calls `@quietr/trpc` client from `apps/web/src/lib/trpc.ts`.
- Requests are handled in `apps/web/src/routes/api/trpc/[...path].ts` using `@quietr/trpc/server`.
- Router procedures currently include Gmail metadata cache helpers.
- Postgres persistence is managed in `packages/database/src/client.ts`.
- Inbox synchronization currently uses periodic polling + manual refresh (no Gmail Pub/Sub in this phase).
- Inbox metadata caching is shared: browser-local TanStack persistence plus server-side Postgres cache accessed via tRPC.
- Manual `queryClient.setQueryData` writes are persisted with `persistQueryByKey` to keep optimistic cache updates durable across reloads.
- Gmail REST calls are defined in `apps/web/src/lib/gmail/gmail-api.ts` and executed through `apps/web/src/lib/google-api/client.ts` to keep new Google API integrations consistent and easy to extend.

### Routing + SSR behavior

- `apps/web/src/app.tsx` must register `Router` + `FileRoutes` and keep root-level providers/shell concerns there.
- Use route-level `route.preload` exports for navigation guards and required preloading.
- Keep API handlers under `apps/web/src/routes/api/**` using SolidStart method exports (`GET`, `POST`, etc.).

### Database and migrations

- Schema changes go in `packages/database/src/schema.ts`.
- Generate migrations with `bun run db:generate` (root) or package-local `db:generate`.
- Apply migrations with `bun run db:migrate` (root) or package-local `db:migrate`.
- Database connections use `DATABASE_URL` (required).

### Shared tooling and config

- Each workspace package has its own scripts and dev dependencies for `oxlint`, `oxfmt`, and `tsgo`.
- Shared TypeScript config is in `packages/config`, while Oxlint/Oxfmt config is at repo root.
- Config files include JSON schemas:
  - Oxlint schema: `./node_modules/oxlint/configuration_schema.json`
  - Oxfmt schema: `./node_modules/oxfmt/configuration_schema.json`
  - TSConfig schema: `https://json.schemastore.org/tsconfig`
- Turborepo environment handling:
  - `envMode` is `strict`.
  - Required task variables are declared with per-task `env` keys in `turbo.json`.
  - `VITE_LOGO_DEV_PUBLISHABLE_KEY` (Logo.dev publishable key) is used for company logo avatars in `apps/web/src/lib/gmail/sender-avatar.ts`.
  - `.env*` files are included for hashing using `globalDependencies`.
  - Turborepo does not load `.env` files for task runtime by itself.
  - `packages/database` scripts load root `.env.local` explicitly with `bun --env-file=../../.env.local ...`.
  - `@quietr/web` keeps `envDir: "../../"` and also hydrates non-prefixed env vars into `process.env` via `loadEnv(mode, "../../", "")` in `vite.config.ts` for server runtime code.

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

Package-level commands:

- `lint`, `lint:fix`, `fmt`, `fmt:check`, and `typecheck` in `apps/web`, `packages/config`, `packages/database`, `packages/trpc`, and `packages/ui`.
- `db:generate` and `db:migrate` in `packages/database`.

## Rules for Agents

1. Keep docs current: if architecture, package layout, routing, API contracts, schema, or tooling changes, update both `README.md` and `AGENTS.md` in the same PR.
2. Preserve package boundaries: avoid direct app-to-database coupling; route through `@quietr/trpc`.
3. Keep type safety strict: avoid `any`; prefer inference and exported shared types.
4. Respect generated files: do not manually rewrite generated route tree or migration metadata without clear reason.
5. For schema changes, always generate and apply migrations, and verify app behavior end-to-end.
6. Before finishing work, run lint, fmt:check, typecheck, and build from repo root.
7. Use `queryOptions` when adding or refactoring TanStack Query usage: for `useQuery`, `prefetchQuery`, or whenever query keys/config are needed in two or more places.
