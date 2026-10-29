# Deployment

## Production

### Merge queue

Auto-merge is enabled for the repository. The `main` ruleset requires the merge queue and the GitHub Actions checks `Lint and typecheck`, `Tests`, `Deployment safety checks`, `Web worker build`, and `Migration integration tests`. The queue uses squash merges, verifies every entry, builds one entry at a time, merges one PR at a time, and allows 30 minutes for checks to report. Existing signature, conversation-resolution, linear-history, force-push, and deletion protections still apply.

The shared `Checks` workflow runs on both pull requests and `merge_group.checks_requested` for `main`, validating the queued changes against the current base branch. Migration integration tests include the Drizzle migration conflict check and validate the combined schema and migrations in the queue. Labeling and external review checks are not required on temporary queue commits.

Use GitHub's merge queue button, or `gh pr merge <number> --auto --squash`, to request a merge after the requirements pass. Enabling auto-merge in repository settings does not enroll existing or future PRs automatically. Once a queued PR merges into `main`, the production deployment below runs through the protected workflow.

Production deploys run through `.github/workflows/sst-deploy.yml` on pushes to `main` or a manual workflow dispatch. A main push first looks for successful merge queue verification of that exact commit in `.github/workflows/ci-main.yml`. Reuse requires a completed successful canonical run, successful jobs from its current attempt, and unchanged evidence on a second read. Incomplete API results, failed or active attempts, missing evidence, and lookup failures run the full reusable verification instead. Manual dispatch always runs fresh verification. The reused run is linked in the job summary. PR and merge queue checks always execute their full suite.

The shared setup action reads Vite+ and Node.js versions from the repository and caches dependencies and the toolchain. SST platform types are installed explicitly for typechecking and deployment. Node and Worker tests run concurrently in one Blacksmith job, and both suites must pass. Production builds remain separate from CI's placeholder build and retain their existing preview-to-deploy integrity checks. SST is the source of truth for application runtime secrets; the protected GitHub `production` environment supplies deployment and operational credentials plus non-secret deployment configuration.

### Product and landing hosts

The product worker and the landing worker are separate TanStack Start builds in the same SST stack. `Web` and its release slots serve `app.quieter.email` and keep skew protection. `Site` serves `quieter.email` and the `www` redirect, with no release slots and no deployment dialog. Credentials stay in the existing SST Secret resources. The site worker links only the database binding it needs for the waitlist and `/api/health`.

`QUIETER_DEPLOY_SURFACE` selects the production publish:

- `app` is the default for pushes to `main`. The launcher excludes `Site`, so an app change does not rebuild or skew-protect the landing worker. It refuses to plan until `https://quieter.email/home` responds with `x-quieter-surface: site`. Until the one-time cutover, merging this split freezes production deploys before migrations.
- `cutover` is manual workflow dispatch only. It deploys both workers and is the only supported way to move `quieter.email` onto `Site` while `Web` takes `app.quieter.email`. Prepare the release plan against `https://quieter.email` for that run, because the public router is still there. Later app deploys prepare against `https://app.quieter.email`.
- `site` is a separate manual workflow, `.github/workflows/sst-deploy-site.yml`. It targets `Site` only, skips migrations and the web release plan, and also refuses to run before the landing header is present.

Sessions stay host-only on the app. There is no parent cookie domain. People sign in again after cutover. OAuth redirect URIs and the Polar webhook should be updated to `https://app.quieter.email` before cutover. The site proxies other `/api/*` requests to the app origin, so an old webhook URL keeps working. Marketing document navigations use HTTP 308. Locally, `vp run dev` stays on port 3000 and `vp run dev:site` uses port 3001. The site is not part of `dev:skew`. Web recovery addresses `app.quieter.email`.

The required check `Web worker build` builds only `@quieter/web`. `.github/workflows/ci-site.yml` builds `@quieter/site` when landing paths change. It is not a ruleset check, so an app-only pull request does not rebuild the landing worker. Shared files in `apps/web/public` are copied into both builds, but a site deploy is still required before the live landing host serves a changed asset. Changes under `packages/app` that the landing page imports, including consent, are similarly snapshotted at the site build.

The release workflow runs the existing CI checks, captures release routing in `.sst/web-deployment.json`, creates `apps/web/.cloudflare/output/v0/workers/default/assets`, conditionally refreshes SST state, and runs `vp run sst diff` to prepare the production web build with SST-resolved configuration. The release plan is created once from the live public deployment status and reused during preview and deployment. It contains build identifiers, slots, and expiration times, with no secrets. An unexpected response fails preparation; a missing status endpoint permits the initial router installation. The asset directory must exist on fresh runners because refresh can reference the previously deployed asset path before SST builds the site. The workflow also creates the former `apps/web/dist/client` directory while migrating to the new output format. Both directories are created before the conditional refresh and before preview, which also refreshes first. These migration directories are not a retained-release artifact store.

Use the canonical launcher, `vp run sst diff --config sst.config.ts --stage production`, followed by `vp run sst deploy --config sst.config.ts --stage production`. For either operation, select the stage through `--stage`, `SST_STAGE`, or the saved `.sst/stage`; the launcher refuses unresolved stages before SST can prompt for one. For production, the launcher validates the release plan and `QUIETER_BUILD_ID`, derives the retained slot exclusions, and rejects caller-supplied `--target` or `--exclude`. Missing or invalid plans fail before SST starts. Bare direct production commands such as `vp exec sst deploy --stage production` bypass the supported retention path. The protected workflow uses the canonical launcher for both preview and deployment.

Before preview starts SST, the launcher writes `.sst/prepared-web-plan.json` with the build ID and a SHA-256 fingerprint of the exact captured plan bytes. Deployment requires that checkpoint to match before SST starts. This nonsecret, ignored preparation metadata detects plan drift even when unknown preview inputs prevent SST from invoking the web build. If the checkpoint is missing or changed, run preview again. When preview skips the build and no completed build receipt exists, protected deployment builds and records one fresh artifact with the resolved SST bindings. Source-map upload must succeed during preparation. Neither preview nor refresh publishes the new Worker.

The Cloudflare Vite plugin builds the web app into `.cloudflare/output/v0/workers/default`, with the server modules in `bundle` and browser assets in `assets`. The `WebTanStackStart` adapter reads `manifest.mainModule` from `worker.config.json` and passes those output paths to SST. SST remains the sole deployer and owns the linked secret bindings; do not deploy this web output with `cf deploy`. `SST_WRANGLER_PATH` remains SST's configuration input contract, which `apps/web/cloudflare.config.ts` translates for the plugin.

`vp run sst deploy` reuses prepared output when a completed `.sst/prepared-web.json` receipt exists and builds once when preparation was skipped. The build writes that receipt only after completion. Its SHA-256 hashes verify every file beneath `.cloudflare/output`, the build ID, the generated SST Wrangler configuration, and the captured release plan bytes. Changed or missing output covered by an existing receipt fails closed without rebuilding. Generated SST and Cloudflare configuration files can contain resolved secrets and must never be uploaded as public artifacts. Keep the receipt and build output private. There is no R2 asset archive.

Preparation can occur during preview or protected deployment. Migrations remain forward-only and expand-safe. Deploys must keep the previous application's database queries, API calls and queued-message formats valid. Add fields before using them, keep readers tolerant of older messages, and remove old contracts in a later reviewed change. The PostgreSQL parser classifies new migrations against a conservative additive allowlist: new tables and enum types, nullable columns without defaults, non-unique indexes, relaxed nullability, and constraint validation. Constraints and unique indexes are accepted for tables created in the same migration. Other operations need a separate contract review; the gate cannot prove application compatibility or acceptable lock duration. Existing migration history is accepted only with the recorded checksums in `packages/database/scripts/historical-migrations.json`; do not add new migrations to that manifest. Non-transactional migrations must contain only concurrent indexes. A migration that begins with `-- quieter:contract` is treated as an explicitly reviewed contract change and may contain destructive or data-modifying SQL. The marker must stay at the top of the migration and is reviewed like the SQL it guards.

After SST finishes, `scripts/check-deployment.ts` verifies the server build ID, a read-only database query, the static build marker, a server-rendered document, and its JavaScript/CSS assets. The landing check uses `/about` and requires a heading. The product check uses `/site-password`, which stays on the app host and is outside the password gate. `/auth` can redirect while that gate is on, and `/about` leaves the app host. The public `/api/health` endpoint returns only a build ID and health status, caches successful database checks for 30 seconds per isolate, and bounds database statements to two seconds. It never returns credentials or user data. A failed check fails the release workflow. Cutover records the previous web release from `quieter.email`, because that host still serves the router. Later app deploys and recovery record it from `app.quieter.email`.

### Open tabs and retained releases

Cloudflare's [version overrides](https://developers.cloudflare.com/workers/versions-and-deployments/version-overrides/) target only versions in the active deployment, with a limit of two versions. SST's regular script upload immediately promotes a version. Two private release Workers avoid a gap in old-version routing during that upload, while SST continues to own deployment and bindings. Requests between the router and app Workers use [HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/).

The existing public `Web` Worker and custom domains remain the entry point. In production, this Worker routes to two private SST-managed app Workers, `WebReleaseA` and `WebReleaseB`. Their stable service names are `quieter-production-web-release-a` and `quieter-production-web-release-b`. Each private Worker owns its server bundle, static assets, linked secrets, and application permissions. The public router receives only service bindings by name and nonsecret release metadata. Neither private Worker has a public URL. During the first router installation, SST keeps the former public app's IAM resources until it has stopped serving requests, strips those credentials from the router's runtime bindings, and removes the legacy IAM resources on the next deployment.

During an advance, the launcher passes the current slot component to SST's native `--exclude`. SST excludes that component and its dependents, so its script, assets, IAM user, policy, and credentials receive no provider planning or update. The prepared build uploads into the other slot. Only that updated slot's script etag blocks router promotion. Router service bindings use stable names rather than slot resource outputs, so excluding the current slot does not exclude the router. This mechanism does not depend on input `ignoreChanges` or old local build files.

Bootstrap excludes neither slot and waits for both script etags before publishing the router. A same-build operation excludes both slots and gives the router no slot-output dependencies, including a retry of the first successful router release. Other infrastructure remains eligible for ordinary updates in all cases. The previous build remains usable for 12 hours after preparation, or until another deployment reuses its slot. Two fixed slots bound retained resources without a cleanup job. The release server validates the selected build before serving requests, so an old router still pointing at a reused slot returns a reload-required response instead of executing incompatible application code. A failed or partially propagated deployment can therefore retire the oldest tab early while the current build continues running.

The excluded slot keeps its embedded bindings and IAM children. Shared secrets and linked infrastructure can still change. Keep shared resources, database contracts, and external permissions compatible with both served releases throughout the retention window. Use expand/contract for changes that would break the frozen runtime.

Immediately before migrations, the workflow rereads the public deployment status and latest build marker, then compares them with the captured predecessor or same-release current build. A changed build or slot fails the workflow before migrations or SST publication. Bootstrap also verifies that the status endpoint is still absent and the legacy marker is unchanged. The original expiration deadline remains fixed throughout preparation and verification.

Browser API and server-function requests include the tab's compiled build identifier. Browser asset URLs include `/_releases/<build-id>/assets/`; those files belong to the same private Worker as that build's server. Document navigation selects the latest build, with no cross-tab affinity cookie. Unpinned external API requests also select the current release. Unknown or expired pins return HTTP 409, `x-quieter-reload: 1`, and a noncached reload message. The router strips provider version-override headers before forwarding requests.

Open tabs check `/assets/deployment.json` on focus and while visible. This noncached public response contains the latest build, retained predecessor, expiration deadline, and fresh server time. Before advertising a predecessor, the router checks its private status endpoint with that build's pin. An expired or reused slot is omitted, including after recovery restores a historical router manifest. The probe takes at most three seconds; unexpected failures return HTTP 503 so tabs do not mistake an outage for eviction. A newer release shows a reload toast while the pinned build is retained. Expiration, slot eviction, or a confirmed reload-required response opens the blocking reload dialog. Network failures do not claim a release expired, and no automatic reload occurs. The first router deployment cannot add request pinning to browser bundles already loaded before this mechanism existed.

### Web recovery

Before changing production, the workflow records the currently healthy web Worker version in the private `previous-web` GitHub artifact, retained for 90 days. The first deployment introducing build markers and health checks has no verified predecessor and therefore no recovery record. Later deployments fail before mutation if the existing marked release is unhealthy; repair the release or recover it before continuing.

For a compatible web-only failure, run **Recover Web Release** on `main`:

1. Select the deployment run ID that recorded the previous healthy version.
2. Inspect the web Worker's current active version UUID in Cloudflare and enter it.
3. Confirm that restoring the previous web code is compatible with the current database, bindings and background jobs.

The workflow uses the protected production environment and the same concurrency group as deployments. It verifies the artifact came from a completed production workflow on `main`, checks the domain's Worker and expected active version, verifies the recorded target build and slot are still retained, probes that build's pinned health endpoint, restores the recorded public router version through Cloudflare, and reruns health checks. No Git history changes or database rollback occur. It is intentionally manual; smoke-test failure does not authorize an infrastructure rollback.

The artifact's 90-day storage period is an audit window, not a promise that its app code remains deployable. Recovery refuses expired or reused slots before changing the public router. Once the router is installed, records created before release retention are also refused because their original app bindings and permissions may have been retired. Use a reviewed forward fix when the target is unavailable. A successful recovery makes the restored build current; the next normal deployment reads that live manifest before choosing which slot to update.

Do not use this button after incompatible schema, binding, Durable Object, queue or background-job changes. Use a reviewed forward fix through SST. Cloudflare can refuse version rollback when dependent resources changed. If restoration succeeds but checks fail, inspect the live state before retrying. The next normal deployment detects the recovery and runs `sst refresh` before planning, reconciling emergency provider changes with SST state. A recovered web release does not establish that background jobs are healthy.

### Local verification

Run `vp check --fix`, `vp test`, and the existing web/handler build checks. `vp exec node scripts/check-deployment.ts <origin> <build-id>` also works against a running local Worker with development bindings. Keep production credentials out of local files. Live production deployment and recovery run only through the protected workflows; unit tests simulate provider failures and artifact tampering without touching production.

For a repeatable two-build browser check, create two ignored output snapshots with distinct build IDs. From PowerShell:

```powershell
New-Item -ItemType Directory -Force .scratch | Out-Null
$env:QUIETER_BUILD_ID = "local-a"
vp run @quieter/web#build
Copy-Item apps/web/.cloudflare/output .scratch/skew-a -Recurse
$env:QUIETER_BUILD_ID = "local-b"
vp run @quieter/web#build
Copy-Item apps/web/.cloudflare/output .scratch/skew-b -Recurse
Remove-Item Env:QUIETER_BUILD_ID
vp run dev:skew .scratch/skew-a .scratch/skew-b
```

Use fresh snapshot directory names when repeating the copy. `dev:skew` accepts a current snapshot, an optional previous snapshot, and an optional port. It chooses a free loopback port by default, validates the approved `.env.local`, and writes private bindings and editable configurations under `.scratch/skew-preview-<port>`. It starts the real router and both built app Workers through local Wrangler, records the child PID, and disables background processing and telemetry. Ctrl+C stops its process tree.

Keep a tab open on the first current build. In the printed router configuration, edit the JSON string in `vars.QUIETER_WEB_DEPLOYMENT` to swap `current` and `previous`, keeping slot `a` with the first snapshot and `b` with the second. Give `previous` an `expiresAt` timestamp in the future. Wrangler reloads the router and the existing tab shows the update toast while its API calls and lazy assets still use the first build. Set that predecessor's expiry in the past, or remove it, to verify the blocking reload dialog. Reload and confirm the new build is used. Never use production snapshots or credentials for this preview.

## GitHub environment contract

The production environment must provide:

- deployment access: `AWS_ROLE_TO_ASSUME`, `AWS_REGION`, `CLOUDFLARE_API_TOKEN`, and `CLOUDFLARE_DEFAULT_ACCOUNT_ID`;
- migration access through `DATABASE_MIGRATION_URL`;
- operational credentials used outside deployed runtimes, currently `GMAIL_CREDENTIAL_ROTATION_TOKEN` and `SENTRY_AUTH_TOKEN`;
- Gmail notification, Polar catalog, R2, Sentry, PostHog, auth-mail, and public browser variables referenced by `.github/workflows/sst-deploy.yml`.

The Cloudflare web Worker reaches Postgres through Hyperdrive (`sst.cloudflare.Hyperdrive` `AppDatabase`), not a raw `DATABASE_URL` TCP pool. AWS mail/background functions still receive a `DATABASE_URL` runtime variable for compatibility, but its value comes from SST Secret rather than the deployment process environment.

Application secrets are cataloged in `packages/env/src/sst-secrets.ts` and declared in `infra/secrets.ts`. Set or rotate them with `sst secret set <Name> <Value> --stage <stage>`, then deploy that stage so runtimes receive the updated value. The production workflow does not copy application secrets from GitHub; `sst deploy` receives only provider credentials, operational/build-only credentials such as the migration and Sentry source-map tokens, and non-secret configuration. Non-sensitive configuration does not need to become a secret.

## Cloudflare dashboard verification

Repository checks cannot validate account-level state. After changing Worker infrastructure, verify that the deployment token remains least-privilege, logs and traces have the intended retention, Gmail Pub/Sub push delivery and retries work with the direct processing acknowledgement deadline, Hyperdrive targets the expected database with query caching disabled, and the production custom domain still routes to its intended Worker. Drain and retire the previous Gmail queue consumer during rollout. Treat this as verification only; SST remains the configuration authority.

## Database safety

`DATABASE_URL` is the least-privilege runtime role. `DATABASE_MIGRATION_URL` is available only to the protected production migration step. Local development must use loopback Postgres or the explicitly allowlisted PlanetScale `quieter_dev` database. Keep `DATABASE_URL` on port 6432, set `DATABASE_MIGRATION_URL` to direct port 5432, and pin their exact host with `QUIETER_LOCAL_PLANETSCALE_HOST`. Do not store production migration credentials in `.env.local`.

Production migration history is never adopted or rewritten automatically. Automated production migrations reject destructive SQL unless the migration explicitly opts in with `-- quieter:contract`, which requires the same review as a manual procedure.

The historical migration chain includes vector columns, so a fresh database still needs the `vector` extension before that migration. The current memory runtime uses categorized plain text and SQL recall. It requires no embedding service or embedding credential. Retired vector columns stay inert until a separately reviewed contract migration can remove them after older workers have been replaced.

## Failure behavior

A preview preparation failure prevents migrations and runtime updates. A deployment-time web build failure can leave migrations and other resources updated. A migration failure stops SST deployment, but earlier migrations may already have committed. An SST failure can leave some resources updated. Smoke checks detect a broken published web release but cannot undo its effects. Keep adjacent releases compatible and use the recovery procedure above where applicable. This workflow does not make the entire AWS/Cloudflare stack transactional.
