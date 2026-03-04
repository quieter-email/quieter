# quietr

`quietr` is a Bun + Turbo monorepo with a SolidStart app and shared packages for database, tRPC, and UI.

## Tech stack

- Runtime and package manager: Bun
- Monorepo orchestration: Turborepo
- App framework: SolidStart + Vite
- API layer: tRPC v11
- Database layer: Drizzle ORM beta + Postgres (Neon HTTP)
- Styling: Tailwind CSS v4
- Linting and formatting: Oxlint + Oxfmt
- Type checking: TypeScript native preview (`tsgo`)

## Workspace layout

- `apps/web`: SolidStart app
  - `src/app.tsx`: router setup, root layout, and global error boundary
  - `src/entry-client.tsx`: client mount entrypoint
  - `src/entry-server.tsx`: server document and render entrypoint
  - `src/routes/index.tsx`: minimal landing page
  - `src/routes/api/trpc/[...path].ts`: tRPC HTTP endpoint
  - `src/lib/trpc.ts`: shared tRPC client instance for the app
  - `src/lib/query-persister.ts`: shared TanStack query persister utilities (including manual persist on cache writes)
  - `src/lib/google-api/client.ts`: reusable typed Google API fetch client + endpoint contract helpers
  - `src/lib/gmail/gmail-api.ts`: Gmail endpoint contracts (path/query/response schema) and typed wrappers
- `packages/database`: Drizzle schema, client, and migrations
  - `src/schema.ts`: auth + app schema definitions
  - `src/client.ts`: Neon + Drizzle client
  - `drizzle.config.ts`: Drizzle Kit config
- `packages/trpc`: shared tRPC router, context, server handler, and client
  - `src/router.ts`: app router with Gmail cache procedures (`gmail.getCachedMessages`, `gmail.upsertCachedMessages`)
  - `src/server.ts`: `fetchRequestHandler` wrapper
  - `src/client.ts`: typed `createTrpcClient`
- `packages/ui`: shared Tailwind theme and UI components
  - `src/styles.css`: Tailwind v4 theme tokens and global base styles
  - `src/components/button.tsx`: Kobalte-based button primitive with variants
  - `src/components/text-field.tsx`: Kobalte-based text field primitives
  - `src/components/card.tsx`: shared card/layout primitives
- `packages/config`: shared TypeScript config package
  - `tsconfig/base.json`: shared TS config (+ JSON schema)
- `oxlint.json`: root shared Oxlint config (+ JSON schema)
- `oxfmt.json`: root shared Oxfmt config (+ JSON schema)

## Architecture flow

1. `apps/web` uses `@quietr/trpc` client in `src/lib/trpc.ts`.
2. Browser requests hit `apps/web/src/routes/api/trpc/[...path].ts`.
3. `@quietr/trpc/server` handles requests through the shared router.
4. `@quietr/database` persists data in Postgres via `DATABASE_URL`.

## Inbox sync strategy

- Inbox list data is cached with TanStack Query and persisted in `localStorage` for instant reload UX.
- Freshness uses periodic polling plus manual refresh (no Gmail Pub/Sub in the current phase).
- Polling is list-first: compare message IDs from `messages.list`, then fetch metadata only for unseen IDs.
- Message IDs and metadata are also persisted server-side in Postgres through tRPC, so repeated metadata calls are reduced across browser sessions.
- Thread bodies are fetched on click for fast navigation with minimal background API usage.
- Manual `queryClient.setQueryData` updates are immediately written to local persistence via `persistQueryByKey` so optimistic UI changes survive reloads.
- Gmail REST calls are centralized through endpoint contracts in `src/lib/gmail/gmail-api.ts`, so adding new Google API calls only requires defining a new endpoint and wrapper instead of wiring ad hoc fetch + schema parsing each time.

## SolidStart routing notes

- `apps/web/src/app.tsx` wires `Router` + `FileRoutes` and owns the global error boundary and shell-level Suspense.
- Route guards are implemented with `route.preload` exports in route files.
- Catch-all API handlers use SolidStart file routes (for example, `src/routes/api/trpc/[...path].ts`).

## Getting started

```bash
bun install
bun run db:generate
bun run db:migrate
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

## Package-local commands

Each package defines its own:

- `lint` (Oxlint)
- `lint:fix` (Oxlint autofix)
- `fmt` and `fmt:check` (Oxfmt)
- `typecheck` (`tsgo --noEmit`)

`@quietr/database` also defines:

- `db:generate`
- `db:migrate`
- `db:push`

## Environment notes

- `VITE_LOGO_DEV_PUBLISHABLE_KEY`: Logo.dev publishable key (starts with `pk_`). Required for company logo avatars. Get one at [logo.dev/signup](https://www.logo.dev/signup). Add to root `.env.local` or `.env`.
- Turborepo is configured in `strict` env mode.
- Variables used by tasks are declared in `turbo.json` task `env` keys.
- `.env*` files are included in Turborepo hashing via `globalDependencies`.
- Turborepo does not load `.env` files into task runtimes by itself.
- `@quietr/database` scripts load root `.env.local` explicitly via `bun --env-file=../../.env.local ...`.
- `@quietr/web` keeps `envDir: "../../"` and also hydrates non-prefixed env vars into `process.env` via `loadEnv(mode, "../../", "")` in `vite.config.ts` for server runtime code.

## Dependency management

- Root `package.json` uses Bun workspaces and `workspaces.catalog` for version pinning.
- Workspace packages consume shared versions via `catalog:` references.
