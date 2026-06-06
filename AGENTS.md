## Stack

- Bun, Turborepo, SST
- `apps/web`: TanStack Start, TanStack Router, React, Vite, Nitro
- Forms: TanStack Form
- Client state: TanStack Query, TanStack Store, TanStack Hotkeys
- API: oRPC + `@orpc/tanstack-query`
- DB: Drizzle + Postgres (Neon HTTP)
- UI: Tailwind CSS 4, `@quieter/ui`, Base UI, Vaul, Sonner, Hugeicons, Tiptap
- Lint/format/typecheck: Oxlint, Oxfmt, `tsgo`

## Boundaries

- `apps/*` consume shared logic via package imports.
- `apps/*` consume reusable UI through `@quieter/ui`.
- Do not import Base UI, Vaul, or Sonner directly in app code unless extending `packages/ui` in the same change.
- `packages/orpc` is the boundary between app and DB logic.
- `packages/mail` owns pure mail parsing, compose schemas, MIME building, message content extraction, and sender avatar derivation.
- `packages/gmail` owns Gmail REST service logic and Gmail-specific draft parsing; encrypted credentials and token refresh are owned by `packages/orpc`.
- `packages/billing` owns PayKit/Polar billing plans, checkout, subscription sync, and webhook handling.
- `packages/database` owns schema and migrations.
- `packages/auth` owns Better Auth config.

## Product Invariants

- Quieter is an email client.
- Google sign-in is identity-only. Gmail authorization uses a separate OAuth client and dedicated PKCE flow.
- Every Gmail and managed mailbox is a persisted `mailbox` row with a stable generated id.
- Gmail credentials live in `gmailCredential`, are encrypted at rest, and are owned by exactly one Quieter user.
- Gmail mailboxes may be placed in Personal or an organization, but remain private to their owner. Organization placement never grants mailbox access.
- Managed mailboxes are organization-owned and visible only through explicit `mailboxGrant` records.
- `user.defaultMailboxId` pins the global default mailbox across Personal and all organizations. Invalid or missing `mailboxId` should resolve to that global default, then the first accessible mailbox.
- Better Auth organization plugin is the source of truth for explicit orgs only. Users can have zero or more organizations. Personal is always available but is not a Better Auth organization.
- Google authentication requests identity scopes only. Gmail authorization requests `https://mail.google.com/` plus identity scopes and uses the exact-mailbox reconnect flow.
- Auth emails send through `POST /api/messages` using `QUIETER_MAIL_API_KEY` and `auth@quieter.email` by default.
- If Gmail exposes `List-Unsubscribe` mailto, use the single unsubscribe action that sends the email.
- Mailbox list selection supports Shift range, Ctrl/Cmd toggle, `Mod+A`, and `Escape`.

## Data + Routing

- App router: [apps/web/src/router.tsx](/E:/Coding/quieter/apps/web/src/router.tsx)
- Root providers/document: [apps/web/src/routes/\_\_root.tsx](/E:/Coding/quieter/apps/web/src/routes/__root.tsx)
- API handlers stay under `apps/web/src/routes/api/**`.
- Use route loaders / TanStack Start server functions for auth guards and request-scoped SSR data.
- Validate search params with `validateSearch` + Zod (colocated on the route file; settings tab ids are shared via `apps/web/src/features/settings/domain/settings-tab.ts`).
- Keep inbox `loaderDeps` limited to `mailboxId`.
- Gmail REST calls run server-side through `packages/gmail`; tokens are decrypted and refreshed through `packages/orpc`.
- Mailbox-scoped query keys must include `mailboxId`.
- Persist manual `queryClient.setQueryData` writes with `persistQueryByKey`.
- Prefer TanStack Query for app-owned async/server state.
- Use TanStack Store for complex client-only workflow state.
- Use named `queryOptions(...)` / `mutationOptions(...)` when config is reused or keys/cache behavior need one source of truth.
- Keep Better Auth reactive hooks (`useSession`, `useListOrganizations`, `useListPasskeys`) as the source of truth for auth state. Do not use Better Auth active organization state for Quieter product context.
- Compose state is mailbox-scoped. Persisted compose sessions and Gmail cache must stay isolated per mailbox.
- Chats are mailbox-scoped. Chat lists, transcripts, mutations, and AI requests require an accessible `mailboxId`.
- Bulk mailbox actions and conversation spam/trash actions operate on the loaded row set for the current mailbox.
- History-based live sync applies to unfiltered mailbox views; filtered search and Drafts refresh manually.
- Message-list prefetch on mount is capped to one extra page.
- Sender avatars are derived at request time, not persisted.

## Mail Infra

- SST owns the standalone SES/S3/SNS mail infrastructure.
- The web app exposes `POST /api/messages` for organization API-key outbound mail. It verifies the Better Auth `organization` API key, requires the `sender` domain to be a verified `mailDomain` for that organization, and sends through SES from `packages/orpc/src/organization-mail.ts`.
- Better Auth email hooks call that endpoint from `packages/auth/src/email.ts`. Set `QUIETER_MAIL_API_KEY` to an organization API key for the organization that owns the auth sender domain. Override `QUIETER_AUTH_MAIL_SENDER` or `QUIETER_MAIL_API_URL` only when needed.
- The mail stack is not currently wired into app-owned DB message records.
- Domain registration should not be added back without rebuilding the integration intentionally.
- Mail ingress/outbound auth tokens come from SST linked secrets.
- Inbound mail is stored under the fixed `mail/inbound/...` key prefix.
- `AWS_REGION` or `AWS_DEFAULT_REGION` is required for the mail S3 uploader.
- Production SST deploys sync `MAIL_BUCKET`, `MAIL_RECEIPT_TOPIC_ARN`, `MAIL_RECEIPT_ROLE_ARN`, and `MAIL_RECEIPT_RULE_SET_NAME` into Vercel as production-only sensitive env vars from `.sst/outputs.json`, then trigger a Vercel production Deploy Hook from `.github/workflows/sst-deploy.yml`. The GitHub environment must provide `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`, and `VERCEL_DEPLOY_HOOK_URL`. Commit-triggered Vercel deployments stay disabled through `vercel.json` `git.deploymentEnabled`; do not use an ignored-build command that exits `0`, because it also cancels Deploy Hook builds.
- Run the combined local dev session with `bun run dev`; Turbo runs the web app and SST mail stack side by side. Run direct SST commands through `bun run sst ...`; the wrapper defaults to `sst.config.ts` and the `mail-dev` stage, and loads AWS credentials from `.env.local`.

## Billing

- Pricing and checkout use PayKit with Polar.
- Subscriptions are user-scoped in `billingSubscription`; checkout metadata must include the Quieter user id and plan so Polar webhooks can reconcile the subscription.
- Paid plans are `managed` and `pro`. Gmail and BYOK remain available without checkout.
- Managed and Pro Polar products are defined in code and synced through PayKit/Polar at checkout. The Polar webhook posts to `/api/billing/polar-webhook` and uses `POLAR_WEBHOOK_SECRET`.
- Organization mail SES usage is metered in `organizationMailUsageEvent`. Managed and Pro include $10 raw SES usage per billing period; overage events are sent to Polar at SES + 5%.

## Schema + Generated Files

- Schema changes go in `packages/database/src/schema.ts`.
- Use `bun run db:push --force` by default.
- Only generate/apply migrations when explicitly needed.
- Do not hand-edit Drizzle migration snapshots unless repairing generated output.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`.

## Style Rules

- Primary cleanup priority: before finishing any implementation, make the code the cleanest minimal shape and remove obsolete paths in the same change.
- Never couple app code directly to the DB; go through `@quieter/orpc`.
- Keep types strict. Avoid `any` and unnecessary casts.
- Use object syntax for conditional classes inside `cn(...)`.
- Avoid unnecessary `useEffect`, especially for resetting or mirroring local UI state.
- Icon-only controls should use the shared tooltip wrapper from `@quieter/ui` and a concise `aria-label`.
- Never use native `<select>` controls in app code. Use the shared Base UI-backed Select components from `@quieter/ui`.
- For incremental UI refinements, preserve existing layout, density, and hierarchy unless asked to redesign.
- Prefer colocated one-off UI logic over extracting helpers used once.
- Inline one-off schemas or validators used only once or twice instead of extracting a named constant for them.
- Avoid unnecessary fallback logic and placeholder compatibility code.
- Inline simple class lists, motion variants, and small constants instead of extracting them.
- Before finishing an implementation, make the code the cleanest minimal shape: avoid duplicate logic, unnecessary abstraction, single-use helpers, excessive object destructuring, one-line helper functions, unnecessary type guards, impossible-case branching, and defensive checks that do not protect a real boundary.
- Do not keep legacy code, placeholder compatibility paths, or fallback branches around when the change makes them obsolete. Remove them in the same change, and call out the removal in the handoff when useful.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): imperative summary`.
- Types: `feat`, `fix`, `docs`, `build`, `refactor`, `test`, `ci`, `perf`, `chore`.
- Optional body: what changed and why, not implementation detail alone.

## Workflow

- Update `README.md` and `AGENTS.md` only for broader logic, architecture, tooling, or workflow changes that make their current guidance inaccurate.
- Before finishing: `bun run fmt`, `bun run lint:fix`, `bun run typecheck`.
