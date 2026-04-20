# quietr

Quietr is a Bun monorepo for an email client centered on Gmail today, with shared packages for auth, database, API, UI, and a small SST-managed mail stack.

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

- Gmail access is mailbox-scoped within the active organization.
- Every user has a personal organization, and connected Gmail mailboxes live there as first-class records.
- `member.defaultMailboxId` controls the default mailbox per organization.
- Google auth requests `https://mail.google.com/` plus profile/email scopes; missing scope goes through a dedicated repair flow.
- Magic-link and verification email delivery still use local placeholder previews rather than real auth email sending.
- Inbox list selection supports mailbox-aware bulk actions, Shift range select, Ctrl/Cmd toggle, `Mod+A`, and `Escape`.
- When Gmail exposes `List-Unsubscribe`, Quietr uses a mailto-based unsubscribe action.

## Architecture

- The app boots from `apps/web`, with route loaders and TanStack Start server functions handling auth guards and request-scoped checks.
- App code talks to shared server logic through `@quietr/orpc`; app code should not couple directly to the database.
- Gmail API access runs server-side in `packages/orpc/src/gmail-service.ts`.
- Mailbox-scoped TanStack Query data always includes `mailboxId` in query keys so persisted caches do not bleed across inboxes.
- Better Auth reactive hooks remain the source of truth for auth state.
- `packages/ui` is the shared UI boundary for app code; app surfaces should import from `@quietr/ui` rather than Base UI, Vaul, or Sonner directly.

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
bun run mail:dev
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

Only the mail infrastructure runs through SST. The web app still runs separately with `bun run dev`.

Mail commands:

```bash
bun run mail:dev
bun run mail:diff
bun run mail:deploy
bun run mail:deploy:production
bun run mail:remove
bun run mail:remove:production
```

SST also has alias commands:

```bash
bun run sst:dev
bun run sst:diff
bun run sst:deploy
bun run sst:remove
```

Local mail workflow:

1. Run `bun run dev`.
2. In another terminal, run `bun run mail:dev`.
3. If needed, set real stage secrets for `MailIngestToken` and `MailSendToken`.
4. Read `.sst/outputs.json` for `mailIngressUrl`, `mailOutboundUrl`, and `mailBucket`.

The mail stack supports:

- protected domain registration through oRPC
- SES domain verification and receipt rule setup
- inbound raw mail storage in S3
- SNS-driven receipt processing into Postgres
- outbound send through SES for configured active domains

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

- `MAIL_INGEST_TOKEN`
- `MAIL_SEND_TOKEN`
- `MAIL_S3_BUCKET`
- `MAIL_S3_PREFIX`
- `MAIL_RECEIPT_TOPIC_ARN`
- `MAIL_RECEIPT_ROLE_ARN`
- `MAIL_RECEIPT_RULE_SET_NAME`
- `MAIL_STACK_OUTPUTS_FILE`
- `AWS_REGION` or `AWS_DEFAULT_REGION`
- `AWS_PROFILE` or equivalent AWS credentials for SST commands

## Database Workflow

- Use `bun run db:push` for normal local schema changes.
- Use `bun run db:generate` and `bun run db:migrate` only when you explicitly want migration files.
- Do not hand-edit generated Drizzle migration snapshots unless repairing generated output.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`.
