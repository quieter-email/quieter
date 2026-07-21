## Stack

- Bun, Vite+, SST
- `apps/web`: TanStack Start, TanStack Router, React, Vite, Nitro
- Forms: TanStack Form
- Client state: TanStack Query, TanStack Store, TanStack Hotkeys
- API: oRPC + `@orpc/tanstack-query`
- DB: Drizzle + Postgres (postgres-js against local Postgres or Neon; Cloudflare Workers use Hyperdrive). Every Worker request, including local Cloudflare Vite development, owns its Postgres client through `withRequestDatabaseClient`; never reuse an I/O-bound client across requests.
- UI: Tailwind CSS 4, `@quieter/ui`, Base UI, Vaul, Sonner, Hugeicons, Tiptap
- Tooling: Vite+ (`vp`), including Vite, Oxfmt, Oxlint, type-aware checks, Vitest, tsdown, and Vite Task

## Boundaries

- `apps/*` consume shared logic via package imports.
- `apps/*` consume reusable UI through `@quieter/ui`.
- Do not import Base UI, Vaul, or Sonner directly in app code unless extending `packages/ui` in the same change.
- `packages/orpc` is the boundary between app and DB logic.
- AWS handlers import only deployment-safe `@quieter/orpc` entrypoints. Keep authenticated
  application services, routers, and framework adapters out of ingestion and worker dependency
  graphs. `vp run @quieter/aws#check:boundaries` validates imports and `vp run @quieter/aws#check:bundles` bundles every
  SST handler to catch unsupported transitive dependencies.
- `packages/mail` owns pure mail parsing, compose schemas, MIME building, message content extraction, and sender avatar derivation.
- `packages/mail/data-plane` owns provider-neutral mail categories, thread/page/detail contracts, semantic commands, mutation results, errors, sync tokens, and role-derived mailbox capabilities. Gmail, managed, API, and demo implementations must adapt to this contract rather than expose provider labels to the UI.
- `packages/gmail` owns Gmail REST service logic and Gmail-specific draft parsing; encrypted credentials and token refresh are owned by `packages/orpc`.
- `packages/billing` owns Polar billing plans, direct SDK checkout and portal sessions, subscription sync, metering, and credit usage.
- `packages/database` owns schema and migrations.
- `packages/auth` owns Better Auth config.
- `packages/env` owns T3 Env schemas and runtime normalization. Use its client/public/server/SST/deployment subpaths instead of reading custom variables directly; bootstrap files that must execute before workspace TypeScript can load are the exception.

## Product Invariants

- Quieter is an email client.
- Google sign-in is identity-only. Gmail authorization uses a separate OAuth client and dedicated PKCE flow.
- Every Gmail and managed mailbox is a persisted `mailbox` row with a stable generated id.
- Gmail credentials live in `gmailCredential`, are encrypted at rest, and are owned by exactly one Quieter user.
- Every user belongs to at least one Better Auth organization. Account creation provisions a normal default team named from the normalized user name plus a stable short id, and existing users are repaired on session load if needed.
- Gmail mailboxes must be placed in an organization but remain private to their owner. Organization placement never grants mailbox access.
- Managed mailboxes are organization-owned and visible only through explicit `mailboxGrant` records.
- `user.defaultMailboxId` pins the global default mailbox across all organizations. Invalid or missing `mailboxId` should resolve to that global default, then the first accessible mailbox.
- Google authentication requests identity scopes only. Gmail authorization requests `https://mail.google.com/` plus identity scopes and uses the exact-mailbox reconnect flow.
- Auth emails send through `POST /api/v1/send` using `QUIETER_MAIL_API_KEY` and `auth@quieter.email` by default.
- If Gmail exposes `List-Unsubscribe` mailto, use the single unsubscribe action that sends the email.
- Mailbox list selection supports Shift range, Ctrl/Cmd toggle, `Mod+A`, and `Escape`.
- Cookie consent uses [c15t](https://c15t.com/) offline mode with browser-only preference storage and a conservative opt-in banner. PostHog loads only after `measurement` consent (`@c15t/scripts`, `loadMode: 'after-consent'`). Client Sentry stays on in production; disclose in the Privacy Policy.
- Signup requires explicit Terms + Privacy acceptance (`user.termsAcceptedAt` via `quieter_terms_accepted_at` cookie). Do not bundle analytics consent into signup or login.
- Legal pages: `/privacy`, `/cookies`, `/terms`. Footer and Settings expose “Manage privacy preferences” (`ConsentDialog`).

## Data + Routing

- App router: [apps/web/src/router.tsx](/E:/Coding/quieter/apps/web/src/router.tsx)
- Root providers/document: [apps/web/src/routes/\_\_root.tsx](/E:/Coding/quieter/apps/web/src/routes/__root.tsx)
- API handlers stay under `apps/web/src/routes/api/**`.
- Consent state is browser-only. Do not add a consent database, backend route, or migration path unless server-side consent records become a demonstrated requirement. Exempt legal routes from the site-password gate.
- Use route loaders / TanStack Start server functions for auth guards and request-scoped SSR data.
- Validate search params with `validateSearch` + Zod (colocated on the route file; settings tab ids are shared via `apps/web/src/features/settings/domain/settings-tab.ts`).
- Keep inbox `loaderDeps` limited to `mailboxId`.
- Gmail REST calls run server-side through `packages/gmail`; tokens are decrypted and refreshed through `packages/orpc`.
- Mail reads and writes use the provider-neutral `mail.listThreads`, `mail.getThread`, `mail.syncMailbox`, and `mail.applyChanges` RPCs. Known writes patch the scoped mail cache directly; do not add broad mail invalidations or provider-specific client mutation paths.
- Archive is a first-class semantic category. Managed Archive uses `mailboxState = archived`; Gmail compiles Archive to the absence of Inbox, Sent, Draft, Spam, and Trash system membership. API mailboxes remain read-only Sent.
- Managed mailbox content changes increment `mailbox.contentRevision`; sync compares the opaque client token to that revision and returns without listing when unchanged.
- Mailbox-scoped query keys must include `mailboxId`.
- Persist manual `queryClient.setQueryData` writes with `persistQueryByKey`.
- Prefer TanStack Query for app-owned async/server state.
- Use TanStack Store for complex client-only workflow state.
- Use named `queryOptions(...)` / `mutationOptions(...)` when config is reused or keys/cache behavior need one source of truth.
- Keep Better Auth reactive hooks (`useSession`, `useListOrganizations`, `useListPasskeys`) as the source of truth for auth state. Do not use Better Auth active organization state for Quieter product context.
- Compose state is mailbox-scoped. Persisted compose sessions and Gmail cache must stay isolated per mailbox.
- Chats are mailbox-scoped. Chat lists, transcripts, mutations, and AI requests require an accessible `mailboxId`.
- Chat generation is server-owned: `chat.sendMessage` persists the user message, `chatRun`, and draft assistant row, then starts generation in-process or through SST (`ChatGenerationQueue` → starter → `ChatGenerationWorkflow`) when `CHAT_GENERATION_START_URL` is set. The browser's `GET /api/chat/runs/$runId/stream` connection is observation-only: it combines same-process events with database-backed rejoin polling and may disconnect or reconnect without owning the run. Postgres draft writes are atomic and debounced for rejoin, other tabs, and tab-close durability. `chat.get` is for initial/historical state, not polling. `chat.cancelGeneration` atomically terminalizes the run and aborts the local controller when present; remote workers also observe the persisted cancel state.
- Bulk mailbox actions and conversation spam/trash actions operate on the loaded row set for the current mailbox.
- History-based live sync applies to unfiltered mailbox views; filtered search and Drafts refresh manually.
- Message-list prefetch on mount is capped to one extra page.
- Sender avatars are derived at request time, not persisted.
- Gmail Pub/Sub is Pro-only. Google authenticated push can land at either the SST API Gateway endpoint or the Cloudflare Worker realtime endpoint. The ingress verifies the OIDC audience and service-account email before durable handoff. The Cloudflare path uses Durable Objects for mailbox-scoped WebSocket fanout and Cloudflare Queues for durable delivery to the authenticated Gmail Pub/Sub processor URL; the AWS path keeps the FIFO SQS/Lambda fallback. `GmailPubSubMaintenance` fans one job per Gmail mailbox every 15 minutes; mailbox jobs renew watches daily and reconcile history because Gmail notifications can be delayed or dropped. Focused, visible browser tabs use `GMAIL_LIVE_SYNC_URL` to receive mailbox-dirty signals and run the existing Gmail history sync immediately; the foreground polling path remains the fallback.
- Gmail AI auto-labeling is an explicit per-mailbox opt-in. It processes only newly added Inbox messages and applies existing custom Gmail labels; only labels with persisted inclusion criteria participate, and the model must satisfy those criteria with direct evidence. It never creates labels. The user-level cloud model preference defaults to `deepseek/deepseek-v4-flash`. Tokens report through the user AI usage meter, and persisted per-message decisions make queue retries idempotent.
- Gmail useful details are a separate explicit per-mailbox Pro opt-in. Newly added Inbox messages are classified with the user-level cloud model preference, which defaults to `deepseek/deepseek-v4-flash`, against a fixed conservative taxonomy and a compact preference profile derived from explicit useful/not-useful feedback. Sender-domain feedback applies immediately, while mailbox-wide category suppression requires repeated feedback; avoided categories are rejected both in the prompt and after classification. Only high-confidence results are accepted. The model selects relevance windows within server safety caps; future items remain hidden until relevant. Verification codes are encrypted at rest. Users can rate or dismiss one item, and disabling the feature deletes every item immediately while retaining preference feedback. Tokens report through the user AI usage meter, and persisted per-message events make retries idempotent.
- `userAiContext` is the single durable cross-agent AI memory. The Settings AI page exposes that Markdown for direct editing and stores the auto-labeling and useful-details model preferences on the same user record. The default chat model is device-local; selecting a model in chat updates that default, while chats with messages reopen on their most recently used model.

## Mail Infra

- SST owns the standalone SES/S3/SNS mail infrastructure.
- The web app exposes `POST /api/v1/send` for organization API-key outbound mail. It verifies the Better Auth `organization` API key, requires the `from` domain to be a verified `mailDomain` for that organization, and sends through SES from `packages/orpc/src/organization-mail.ts`.
- Better Auth email hooks call that endpoint from `packages/auth/src/email.ts`. Set `QUIETER_MAIL_API_KEY` to an organization API key for the organization that owns the auth sender domain. Override `QUIETER_AUTH_MAIL_SENDER` or `QUIETER_MAIL_API_URL` only when needed.
- Managed mailbox messages are persisted in `managedMailMessage`. Inbound SES receipt processing parses the raw S3 object and writes one row per exact managed mailbox recipient; managed app sends and exact-sender `POST /api/v1/send` sends write outbound rows.
- Managed mailbox UI supports Inbox, Sent, Drafts, Spam, Trash, read/unread state, structured search, shared conversation labels, shared and personal saved views, manager-controlled automatic label rules, threads, replies, forwards, and compose.
- Managed labels are shared mailbox workflow state. Readers can browse and filter labels, responders can apply them, and managers own label definitions, shared views, rules, and historical rule backfills. Personal saved views remain private to their owner.
- Domain registration should not be added back without rebuilding the integration intentionally.
- Mail ingress/outbound auth tokens come from SST linked secrets.
- Inbound mail is stored under the fixed `mail/inbound/...` key prefix.
- Managed inbound raw objects must have at least one `managedMailMessage` reference. R2 is the canonical production raw-object store, with SES S3 used only as a temporary landing bucket for SES receipt rules. Ingestion deletes untracked raw objects immediately, the SES landing bucket has a one-day lifecycle safety net, and managed message deletion removes the canonical raw object synchronously when deleting its final database reference. Existing S3-backed rows remain supported during the R2 backfill/contract migration.
- `AWS_REGION` or `AWS_DEFAULT_REGION` is required for the mail S3 uploader.
- Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or manual dispatch, using the protected GitHub `production` environment. They verify quality checks, apply committed forward migrations, synchronize GitHub secrets into SST's encrypted secret store, and deploy both the AWS mail/background stack and Cloudflare web Worker through SST. Generated SST outputs are bound directly to the Worker; do not copy them into another dashboard. GitHub is the only manually configured source of deployment variables and secrets. The required runtime secret map lives in `packages/env/src/github.ts`, and `scripts/sync-sst-secrets.ts` publishes it before every deploy. Remote migration credentials remain protected GitHub-only values, automated production migrations reject destructive SQL, and production migration history is never adopted or rewritten automatically.
- Pull request review deployments are opt-in through `.github/workflows/review-deploy.yml` and the GitHub `Review` environment. Only the repository owner, validated by exact GitHub login and immutable user id, can trigger one by posting the exact `quieter review` comment on an open same-repository pull request or by using the owner-only manual fallback. The comment is the authorization signal and accepted commands receive a rocket reaction. The workflow resolves the pull request to an exact SHA, verifies and bundles it without secrets, then uses trusted default-branch configuration to upload the inert artifact to the fixed `https://review.quieter.email` Worker. Pull-request code must never execute in a job that holds the Cloudflare deployment token. The workflow is never a required pull request check and must not block or delay merging. Fork pull requests cannot be promoted, `pull_request_target` must not execute pull-request code, and dynamic `pr-*` stages or provider preview URLs must not be reintroduced. Review runtime credentials and the synthetic database are isolated from production, remote database migrations never run, and first-time Google sign-in is limited to the Review OAuth project's explicit test-user list. Use only dedicated test mailboxes for Gmail authorization. Shared Review deployments keep preview personas disabled; personas remain a local-only testing aid.
- The GitHub production environment must also provide `POLAR_PRODUCT_MANAGED_ID` and `POLAR_PRODUCT_PRO_ID`.
- Local development uses local Postgres only. `vp run dev` rejects remote `DATABASE_URL` and `DATABASE_MIGRATION_URL` values and starts only the web app. The local Cloudflare Worker config declares the allowlisted bindings loaded from the root `.env.local`; keep `apps/web/local-worker.jsonc` synchronized when a local server variable is added. `vp run env:doctor` must pass after `.env.local` edits; it rejects production-shaped provider, mail, billing, AI, observability, and storage keys in the active local env file. Developers never receive production database credentials. CI migration verification uses its temporary Postgres service container; do not provision hosted databases for pull requests. Run optional SST mail/background infrastructure with `vp run dev:mail`, or run both web and SST with `vp run dev:all`. Run direct SST commands through `vp run sst -- ...`; the wrapper defaults to `sst.config.ts` and the `mail-dev` stage, loads `.env.local`, and overlays optional non-production SST credentials from `.env.sst.local`.
- Vite Task derives workspace build order from package dependencies. Keep custom task inputs and environment variables explicit whenever enabling task caching, and ensure `@quieter/env` builds before Node-loaded Vite configuration runs.

## Billing

- Pricing and checkout use the Polar SDK directly. Better Auth owns the verified Polar webhook endpoint.
- Billing is organization-only. Every `billingSubscription` points directly at an organization while `userId` records the purchaser.
- Paid products are `managed` and `pro`. The production Polar dashboard is the catalog source of truth unless it is clearly misconfigured. Managed is $15/month with $10 organization credits and managed mail. Pro is $25/month with $20 organization credits, managed mail, and AI for members. All billing and usage accounting is in US dollars. Gmail and BYOK remain available without checkout.
- Organizations persist one stable billing owner. Administrative/test entitlements use audited
  `billingEntitlementOverride` rows rather than source-controlled email bypasses.
- Polar products are mirrored in code and reconciled by `vp run billing:sync-polar`; production dashboard values win over local variants unless the dashboard is clearly wrong. Checkout metadata includes the Quieter user id, product, and organization id. The Polar access token must include customer read/write access so checkout can create and resolve team customers. Better Auth receives Polar webhooks at `/api/auth/polar/webhooks` using `POLAR_WEBHOOK_SECRET`. Successful checkout redirects also carry the Polar checkout id so local sandbox development can synchronize without a publicly reachable webhook.
- AI and managed-mail costs consume the same US-dollar organization balance through `billingCreditUsageEvent`. Credit usage events are sent to Polar so meter credits are consumed there too; local billing credit usage remains the application source of truth for gating and usage breakdowns. AI costs use the provider-reported US-dollar request cost plus a 15% cost-recovery fee so cache discounts and cache-write charges pass through accurately. Managed-mail usage costs twice the provider's US-dollar cost on both paid plans; customer-facing pricing shows the resulting rates rather than an infrastructure markup.

## Schema + Generated Files

- Schema changes go in `packages/database/src/schema.ts`.
- Generate and commit a Drizzle migration for every schema change with `vp run db:generate`.
- Run `vp run db:check` to validate migration history and confirm `schema.ts` has no uncommitted drift.
- `vp run db:push -- --force` is only for disposable local databases. Never use `db:push` against production.
- Production migrations run automatically in `.github/workflows/sst-deploy.yml`; do not apply production migrations locally.
- Keep migrations compatible with the currently running release. Use expand/contract deployments for renames, required columns, destructive changes, type rewrites, and large backfills. Use reviewed custom SQL with concurrent index creation for large indexes.
- Mark migrations containing `CREATE INDEX CONCURRENTLY` with `-- quieter:no-transaction`. Keep every statement in those migrations safely retryable; the forward migration runner executes them under an advisory lock outside Drizzle's transaction and records them in the normal Drizzle history.
- Do not hand-edit Drizzle migration snapshots unless repairing generated output.
- Do not hand-edit `apps/web/src/routeTree.gen.ts`.
- Database scripts use the Drizzle Kit programmatic SDK (`check`, `generate`, `push` from `drizzle-kit/cli`) via `packages/database/scripts/drizzle-kit.ts`. `migrate` is still CLI-only (`runKitMigrate` in the same file). See [Drizzle Kit SDK](https://github.com/drizzle-team/drizzle-orm/blob/v1.0.0-rc.4/drizzle-kit/SDK.md).
- **Upgrading `drizzle-kit` / `drizzle-orm`:** keep the workspace catalog on the release-candidate channel until v1 is stable, but pin exact rc versions rather than using a range that can resolve to suffixed prerelease builds. After bumping the root `package.json`, run `vp install`, verify `drizzle-kit/cli` resolves from the installed package, then re-run `vp run db:check`, `vp run db:generate`, and the database tests before finishing.

## Style Rules

- Primary cleanup priority: before finishing any implementation, make the code the cleanest minimal shape and remove obsolete paths in the same change.
- User-facing copy describes capabilities and outcomes, not implementation details. Never expose infrastructure or provider terms such as Pub/Sub, AWS, SES, S3, SQS, SST, API Gateway, or model identifiers in product UI or user-facing errors. Keep technical names only where the user must configure or interoperate with them, such as DNS records and API keys.
- Never couple app code directly to the DB; go through `@quieter/orpc`.
- Keep types strict. Avoid `any` and unnecessary casts.
- Use object syntax for conditional classes inside `cn(...)`.
- Use named theme colors from `packages/ui/src/styles.css`; do not use arbitrary bracketed color values in class names. Adjust an existing theme variable or add a named variable when the palette needs a new color.
- Avoid unnecessary `useEffect`, especially for resetting or mirroring local UI state.
- Icon-only controls should use the shared tooltip wrapper from `@quieter/ui` and a concise `aria-label`.
- Never use native `<select>` controls in app code. Use the shared Base UI-backed Select components from `@quieter/ui`.
- For incremental UI refinements, preserve existing layout, density, and hierarchy unless asked to redesign.
- Prefer container queries over viewport media queries when a component's layout should respond to its own available space. Keep media queries for viewport-level page shells, device or input capabilities, user preferences, and print styles.
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
- Before finishing: `vp check --fix`, `vp run check:copy`, `vp test`, and `vp run -r build`.
