# quieter

Quieter is a Bun monorepo for an email client centered on Gmail today, with shared packages for auth, database, API, UI, and a small SST-managed mail stack.

## Stack

- Runtime/package manager: [Bun](https://bun.sh/)
- Monorepo: [Turborepo](https://turbo.build/repo)
- Frontend: [TanStack Start](https://tanstack.com/start), [TanStack Router](https://tanstack.com/router), [React](https://react.dev/), [Vite](https://vite.dev/), [Nitro](https://nitro.build/)
- Forms/state: [TanStack Form](https://tanstack.com/form/latest), [TanStack Query](https://tanstack.com/query/latest), [TanStack Store](https://tanstack.com/store/latest/docs/overview), [TanStack Hotkeys](https://tanstack.com/hotkeys/latest)
- API: [oRPC](https://orpc.dev/docs/getting-started) + [`@orpc/tanstack-query`](https://orpc.dev/docs/integrations/tanstack-query)
- Database: [Drizzle ORM](https://orm.drizzle.team/) + Postgres (Neon HTTP)
- UI: [Tailwind CSS 4](https://tailwindcss.com/), [Base UI](https://base-ui.com/), [Vaul](https://vaul.emilkowal.ski/), [Sonner](https://sonner.emilkowal.ski/), [Hugeicons React](https://www.npmjs.com/package/@hugeicons/react), [Tiptap](https://tiptap.dev/)
- Tooling: [Oxlint](https://oxc.rs/docs/guide/usage/linter), [Oxfmt](https://oxc.rs/docs/guide/usage/formatter), `tsgo`

## Packages

- `apps/web`: TanStack Start app and inbox UI
- `packages/auth`: Better Auth configuration
- `packages/database`: Drizzle schema and DB client
- `packages/orpc`: shared API router, services, and typed client
- `packages/ui`: shared UI wrappers and theme surface
- `packages/aws`: standalone inbound/outbound/receipt mail handlers used by SST
- `packages/config`: shared TypeScript config

## Product Notes

- Gmail access is resolved from the selected Better Auth linked Google account in the user's personal organization.
- Managed/non-Gmail mailboxes are table-backed records; Gmail accounts are not persisted in the `mailbox` table.
- `member.defaultMailboxId` controls the default mailbox per organization and stores either a Gmail mailbox key or a managed mailbox id.
- Google auth requests `https://mail.google.com/` plus profile/email scopes; missing scope goes through a dedicated repair flow.
- Magic-link and verification email delivery still use local placeholder previews rather than real auth email sending.
- Inbox list selection supports mailbox-aware bulk actions, Shift range select, Ctrl/Cmd toggle, `Mod+A`, and `Escape`.
- When Gmail exposes `List-Unsubscribe`, Quieter uses a mailto-based unsubscribe action.

## Architecture

- The app boots from `apps/web`, with route loaders and TanStack Start server functions handling auth guards and request-scoped checks.
- App code talks to shared server logic through `@quieter/orpc`; app code should not couple directly to the database.
- Gmail API calls run server-side in `packages/orpc/src/gmail-service.ts`; token lookup and refresh go through Better Auth linked accounts.
- Mailbox-scoped TanStack Query data always includes `mailboxId` in query keys so persisted caches do not bleed across inboxes.
- Better Auth reactive hooks remain the source of truth for auth state.
- `packages/ui` is the shared UI boundary for app code; app surfaces should import from `@quieter/ui` rather than Base UI, Vaul, or Sonner directly.

## Inbox Sync

- Browser-side TanStack Query persistence restores cached mailbox state before network sync.
- Unfiltered mailbox views use Gmail history deltas for live sync.
- Filtered search views and Drafts refresh manually.
- Message-list mount prefetch is capped to one extra page.
- Manual optimistic cache writes are persisted so they survive reloads.
- Thread bodies and non-inline attachment metadata are fetched on demand.

## Getting Started

```bash
bun install
bun run db:push
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Common Commands

```bash
bun run dev
bun run sst dev
bun run lint
bun run lint:fix
bun run fmt
bun run fmt:check
bun run typecheck
bun run build
bun run db:push
bun run db:generate
bun run db:migrate
```

## Mail Stack

Only the mail infrastructure is managed by SST. For local development, `bun run dev` starts the web app and SST mail stack side by side through Turbo. Use `bun run sst ...` when you want to run SST directly.

Mail commands:

```bash
bun run sst dev
bun run sst diff
bun run sst deploy
bun run sst deploy --stage production
bun run sst remove
bun run sst remove --stage production
bun run sst unlock
```

Local mail workflow:

1. Run `bun run dev`.
2. If needed, set real stage secrets for `MailIngestToken` and `MailSendToken`.
3. Read `.sst/outputs.json` for `mailIngressUrl`, `mailOutboundUrl`, and `mailBucket`.

The mail stack supports:

- standalone SES/S3/SNS infrastructure managed by SST
- token-protected inbound raw mail storage in S3
- SNS receipt notifications for later processing
- token-protected outbound send through SES

It is not currently wired into the web app or oRPC. Domain registration and app-owned managed mail records have been removed so the mail setup can be rebuilt cleanly later.

## Environment

Core:

- `DATABASE_URL`
- `BETTER_AUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Auth/runtime:

- `BETTER_AUTH_URL` or `VERCEL_URL`
- `NEXT_PUBLIC_LOGO_DEV_PUBLISHABLE_KEY`
- `VITE_LOGO_DEV_PUBLISHABLE_KEY` as legacy fallback

Mail:

- `AWS_REGION` or `AWS_DEFAULT_REGION`
- `AWS_PROFILE` or equivalent AWS credentials for direct SST commands

The mail ingress/outbound auth tokens are provisioned as SST linked secrets rather than configured as repo env vars, and inbound mail is stored under the fixed `mail/inbound/...` key prefix.

The repo `bun run sst ...` wrapper defaults local SST commands to `sst.config.ts`, the `mail-dev` stage, and the `quieter-sst` AWS profile fallback.

On Windows ARM64, the wrapper also seeds SST's local Pulumi plugin cache with the `windows-amd64` `random` provider when Pulumi requests a version that is not published for `windows-arm64`.

## Database Workflow

- Use `bun run db:push` for normal local schema changes.
- Use `bun run db:generate` and `bun run db:migrate` only when you explicitly want migration files.
- Do not hand-edit generated Drizzle migration snapshots unless repairing generated output.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`.
