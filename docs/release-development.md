# Release controller development

Milestone A is in progress. Production still runs the legacy SST workflow. `@quieter/deployment` currently rejects mutations outside isolated `release-proof-*` stages. Do not remove that restriction until the ownership, artifact, trigger, and recovery workflow gates in the [approved plan](mail-platform-reliability-plan.md) pass.

## Implemented

`release plan --source <full-commit-sha> --directory <absolute-checkout>` reads the journal's last healthy source and compares it with the exact candidate tree. Fetch complete Git history first. An unfinished release, missing ancestry, stale rerun, or divergent history blocks planning. The planner reads manifests from both commits and includes accumulated changes from skipped runs. It ignores uncommitted files.

The current runtime registry lists the six Workers and three Lambda handlers that already exist. Workspace dependency coverage is conservative at package granularity, so a shared Cloudflare package change includes all its handlers. Dashboard-only source and UI changes do not include mail consumers. Root build tooling and lockfile changes invalidate every runtime; infrastructure and database schema changes require the foundation path. Unclassified files block runtime-only planning. This is a dependency plan, not build or authorization evidence. Trigger and ownership blockers remain explicit in each registration, and the eventual protected workflow must enforce them before activation.

- A complete release map with artifact digests, binding generations, and dependency contracts.
- Compatibility checks for intermediate promotion states and retained producer contracts after rollback.
- Intent recorded before every pointer change, conditional journal updates, immutable checksummed checkpoints, and reconciliation of lost activation responses.
- Recovery from a separate process, drift detection across the entire map, quarantine of failed artifacts, and refusal to start over unresolved attempts.
- Three protected candidate checks before activation and a two-minute clean health window afterward, with actual version identity on every sample. Transient failures restart the window; three consecutive candidate failures with a passing baseline confirm regression. Configured critical safety checks fail immediately. Missing telemetry never certifies a release.
- Compensation records actual candidate activation, preserves quarantine evidence across interrupted recovery, and checks restored service health before marking rollback complete. Pre-activation archive failures remain repairable without quarantining code that never ran.
- Browser asset inventory, immutable uploads, byte/MIME verification, receipt written last, and repair from the same artifact. Receipts are excluded from public fallback.
- Immutable artifact manifests retained alongside the journal. Bootstrap, preparation, and promotion require these manifests; preparation and promotion verify both the candidate and rollback target's browser archives. Recovery does not require build files or archive access.
- Deterministic compiled module/static asset manifests, byte verification before upload, and native inactive uploads inheriting bindings from an explicit baseline UUID. Uploads reject compatibility changes, binding removal, incomplete assets, and active-deployment drift.
- Independent recovery checks the journal's recorded GitHub writer, waits for that writer to end, and rejects obsolete completion events. The recovery workflow uses separately pinned tooling and the shared mutation group. It remains disabled pending environment configuration and cutover.

The controller alone is not a deployment lock. Every mutating production workflow and emergency operator must share the ownership rule. Cloudflare has no compare-and-set deployment endpoint; read-before-write cannot fence a competing external operator.

## Isolated provider proof

`sst.release-proof.config.ts` provisions a separate probe Worker, R2 bucket, and versioned private S3 journal. It has no application database, customer mailbox, SES, or background-processing bindings. The probe requires an SST-linked secret. Use an authenticated AWS profile and the existing Cloudflare deployment credential.

```powershell
vp run @quieter/env#build
vp exec sst secret set ReleaseProofToken --config sst.release-proof.config.ts --stage release-proof-leander
vp exec sst deploy --config sst.release-proof.config.ts --stage release-proof-leander
```

Supply a random secret of at least 32 characters through stdin. Do not place it in shell history. Record the baseline deployment ID/version from Cloudflare and the public stack outputs in ignored `.scratch/` files before the candidate upload.

```powershell
$env:QUIETER_RELEASE_PROOF_PHASE = "candidate"
vp exec sst deploy --config sst.release-proof.config.ts --stage release-proof-leander
```

The existing `WorkersScript` stores its baseline module inline and ignores changes during the candidate phase. File-backed content is unsafe here: a later build can replace the retained path's bytes while Pulumi retains its previous checksum. The `adopt` phase is only for the recorded development transition from file-backed state. It requires the exact original compiled module downloaded from the provider, verified against its original checksum. Do not apply it to production without its own reviewed inventory and transition.

`WorkerVersion` uploads the compiled module and linked bindings without activating it. The checked-in proof rejects unsupported binding types and Durable Object migrations rather than silently dropping them. Rebuild `@quieter/env` before deploying after changing its schema; SST consumes its compiled package export.

Set `QUIETER_RELEASE_BUCKET`, `QUIETER_RELEASE_STAGE`, `CLOUDFLARE_ACCOUNT_ID`, and `AWS_REGION` from the intended proof stage. The CLI uses AWS's credential chain and the existing `CLOUDFLARE_API_TOKEN`. Read configuration through `@quieter/env/deployment`.

```powershell
vp run @quieter/deployment#release status
vp run @quieter/deployment#release register --file <absolute-artifact-manifest> --directory <absolute-built-directory>
vp run @quieter/deployment#release bootstrap --file <absolute-baseline-manifest> --probes <absolute-probe-configuration>
vp run @quieter/deployment#release prepare --attempt proof-recovery --run 1 --file <absolute-candidate-manifest> --probes <absolute-probe-configuration>
vp run @quieter/deployment#release promote --attempt proof-recovery
vp run @quieter/deployment#release recover --attempt proof-recovery --reason process_ended
```

Each command is a separate process. If a command fails, read status and actual provider state before continuing. Do not bootstrap over an existing journal or delete history to rerun a failed release. A failed recovery stays discoverable and blocks the next release. The final `rolled_back` state must match the original baseline version. The new deployment ID will differ because restoration itself creates a deployment.

Registration checks every compiled module and static file against the manifest, verifies its archive, then creates the manifest conditionally in the journal bucket. Register every referenced artifact before bootstrap or preparation. Preflight downloads the selected provider version's modules and compares their bytes, MIME types, compatibility settings, and routing configuration with the retained artifact. It accepts SST's main-module alias while checking the complete module set. An available native artifact tag must also match. Old probe runs used synthetic digests without retained manifests; they remain historical evidence and cannot be promoted through the new gate. Workflow provenance, durable upload reconciliation, and binding-generation approval remain separate unfinished requirements.

Probe configuration maps each service name to its public `url`, protected `candidateUrl` and `baselineUrl`, required `checks`, and optional `criticalChecks`. Critical checks must also appear in `checks`. Each endpoint returns the actual provider `versionId` and Boolean results for every named check. Preparation retains this configuration in the attempt. Promotion, observation, and recovery need the operational probe secret through their intended linked configuration. Recovery uses the restored public URL, requires three passing samples, and checks the complete provider map again afterward. A failed recovery health check leaves the attempt discoverable as `recovering`.

Older terminal journal records omit probes and activation history. They remain readable. They do not establish health for a new run; an unfinished historical attempt without probes needs explicit reconciliation. Production recovery still needs its separate SST-linked health credential wiring before cutover.

## Evidence recorded on 2026-09-06

- Pinned SST 4.17.1 and Cloudflare Pulumi 6.15.0 created an inactive native version while preserving the exact active deployment ID.
- The provider rejects `modules.contentSha256` as read-only despite exposing it in its TypeScript input definition. Uploading the compiled bytes through `contentBase64` works and makes content changes visible to Pulumi.
- A real S3 connection reset left a durable `prepared` attempt. A fresh process read it, promoted the candidate, and another process restored the original Cloudflare version.
- The first subsequent SST test used unchanged source. Changing the source exposed the file/checksum problem above. After moving baseline content inline, source changes uploaded new candidates without replacing the active baseline.
- Cloudflare's older multipart version endpoint rejects explicit binding-source UUIDs and only accepts `latest`. The JSON version endpoint used by the pinned provider accepts the baseline UUID with `deploy=false`. The native uploader uses that endpoint, checks returned binding names/types, and never falls back to `latest`.
- A native candidate inherited the active baseline's bindings while a newer SST-uploaded candidate had different configuration. Authenticated candidate code and static assets passed; unauthenticated access returned 404. `_headers` behavior passed and the active deployment ID stayed unchanged.
- The isolated credential initially included PowerShell's trailing newline. It was corrected through stdin without changing any production secret. That correction and later asset-binding addition deliberately established new fixture baselines. The earlier journal remains intact as historical recovery evidence and must not be treated as the current fixture baseline.
- Unit tests cover interruption around journal writes, lost activation responses, stale writers, external drift, failed compensation, quarantined artifacts, incompatible contracts, archive repair, corruption, and missing objects behind a valid receipt.
- The native R2 development binding passed interrupted-upload, idempotent-repair, and missing-object drills without changing the active runtime. Bulk transfers through Wrangler's remote proxy later failed with internal errors. Release archives therefore use the R2 S3 API with short-lived credentials instead of the development proxy.
- The actual TanStack artifact contains 315 modules, 172 static assets, and 145 retained browser assets. Its complete archive passed byte, MIME, and receipt verification in the isolated bucket. Repeating upload and verification after a machine shutdown passed using the same artifact, without rebuilding.
- A fresh `release-proof-leander-v2` stage passed baseline bootstrap, protected candidate checks, actual two-minute certification, explicit rollback with another two-minute certification, and separate-process compensation after promotion ended before certification. The final pointer returned to the original version; restored health passed and the failed attempt's artifact was quarantined.
- A subsequent SST update created a separate web proof Worker and another inactive probe version. It preserved the tested probe's exact deployment ID and version. Provider module readback also matched the retained baseline.
- The real TanStack build rendered `/terms` remotely from an inactive version. A small outer fixture permits only that public page and static assets, strips session cookies, and rejects mutations. It uses SST-linked development database/auth configuration, with a guard requiring `quieter_dev`. Anonymous page and asset requests returned 404, mutations returned 405, and authenticated JavaScript, CSS, and font bytes and MIME types matched. Every uploaded module matched the retained manifest; the active web pointer stayed unchanged.

These tests establish the controller, linked Worker behavior, and native upload of a compiled TanStack application with assets. The web fixture adds an outer guard and runs the Worker before assets; its derived artifact has a separate digest. It is an SSR/static-asset test, not full authenticated application coverage. Protected production previews, queue/scheduled/DO version selection, production ownership transfer, and a live independent recovery workflow remain unverified. No production pointer, secret, or database was changed by this proof.

Run the native upload proof under the limited SST operations target. It copies the compiled probe, adds a candidate asset, uploads exact bytes, and tests the versioned preview. It does not activate the upload.

```powershell
vp exec sst shell --config sst.release-proof.config.ts --stage release-proof-leander --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-upload-proof.ts
```

The complete controller drill uses a fresh baseline-stage journal and actual version metadata. It refuses an existing journal; inspect and resume interrupted steps through the CLI rather than deleting history. Each command inside the drill runs in a separate process.

```powershell
vp exec sst shell --config sst.release-proof.config.ts --stage release-proof-leander-v2 --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-controller-proof.ts
```

For the optional web proof, set `QUIETER_RELEASE_WEB_PROOF=true`, supply `ReleaseWebDatabaseUrl` from the approved development database and a separate random `ReleaseWebAuthSecret` through SST stdin, then preview/deploy the proof stage. Keep `QUIETER_RELEASE_PROOF_PHASE=candidate` after establishing its baseline. The web fixture's inline baseline remains frozen across later updates.

```powershell
vp exec sst shell --config sst.release-proof.config.ts --stage release-proof-leander-v2 --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-web-proof.ts --directory <absolute-built-directory> --manifest <absolute-artifact-manifest>
vp exec sst shell --config sst.release-proof.config.ts --stage release-proof-leander-v2 --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-web-receipt.ts
vp run @quieter/deployment#release verify-artifacts
```

The receipt command repeats read-only provider/module and HTTP checks against the retained web candidate. It neither rebuilds nor uploads another version.

## Inactive upload recovery

Registration now retains every compiled module and static file in the private release bucket. Each conditional upload is read back and checked against the tested bytes and MIME type. The compiled receipt is written last. `release restore --artifact <digest> --directory <new-absolute-directory>` requires that receipt and verifies every downloaded file. It refuses an existing destination and never restores secrets or build configuration. Version-2 artifacts also restore private source maps into their separate directory. A failed restore leaves a partial directory for inspection; use a fresh destination when retrying.

On 2026-09-06, the complete protected web candidate was retained in the isolated release bucket and restored into a fresh local directory. Every compiled module and static file matched the original tested manifest. No rebuild or runtime activation occurred.

Register the tested artifact and verify its archive before invoking `release upload --file <intent.json> --directory <compiled-directory>`. The intent contains a UUID, artifact digest, exact baseline deployment/version, script name, creation time, and workflow run ID. Keep that identity across retries. The journal conditionally creates the intent before contacting Cloudflare; only the process that creates it may upload. An uncertain journal write stops the process.

Cloudflare versions carry the upload UUID and inherited baseline in their annotations. `release reconcile-upload --attempt <uuid>` scans bounded version history, rejects duplicate/conflicting matches, compares the complete compiled modules, verifies the archive, and checks the unchanged active deployment before retaining a receipt. A missing match remains unknown and never causes an automatic re-upload. If a runner stopped between claiming and sending, an operator can review and start a distinct inactive upload after confirming that the old writer ended. Activation still requires the normal release checks.

The live `verify-upload-recovery.ts` drill passed on `release-proof-leander-v2` on 2026-09-06. It discarded an accepted upload response, recovered the exact version in a fresh process, retried the original intent without another upload, and preserved the active deployment. This exercises local process recovery; the independent GitHub workflow remains a separate cutover gate.

## Archive verification

Generate the release artifact once with `@quieter/deployment#artifact`. Keep its compiled directory and manifest together. The archive CLI checks the manifest's digest and complete browser-file coverage, then checks the compiled modules before accessing the archive. Never rebuild to repair an upload under an existing manifest.

Set `CLOUDFLARE_ARCHIVE_PARENT_KEY_ID` to the existing R2 parent access key ID. The bootstrap API credential mints temporary credentials for one bucket, limited to `assets/` and `receipts/`, with a ten-minute lifetime. The SDK refreshes them during longer uploads. `--verify` requests read-only access. The parent credential must already have the intended R2 permissions; this command does not change account permissions.

```powershell
vp run @quieter/deployment#archive --bucket release-proof-leander-archive --directory <absolute-built-directory> --manifest <absolute-artifact-manifest>
vp run @quieter/deployment#archive --bucket release-proof-leander-archive --directory <absolute-built-directory> --manifest <absolute-artifact-manifest> --verify
```

Both commands require the isolated stage configuration described above. Uploads create objects conditionally and verify existing bytes on a rerun. A receipt is written only after every referenced file passes verification. Verification reads every object even when the receipt exists.

## Database durability evidence

Read-only PlanetScale inspection on 2026-09-06 found the existing `quieter` main branch on a single-node PS-5 configuration in AWS Frankfurt, with zero replicas and a 50-connection PostgreSQL limit. PgBouncer allows 4,000 client connections; that does not increase the database's execution capacity. The default MCP SQL connection used the `postgres` database, so its settings are not evidence of application-database overrides. Access to `quieter_dev` through that connector was denied; no permissions were changed.

This topology does not establish provider-failure RPO 0 or high availability. Keep the submission guarantee scoped to application failures while the database and payload store remain intact. A topology change needs a separate cost and infrastructure decision. See [PlanetScale single-node documentation](https://planetscale.com/docs/postgres/cluster-configuration/single-node).

## Existing production ownership

### Durable Object fixture

The `release-proof-do-leander` drill passed on 2026-09-06 using `sst.release-durable-proof.config.ts`. Namespace `05bea87f189c4e30b1a98b06d38aaf24` retained its counter across inactive upload, activation of `30e15fce-8968-4df4-8147-22757efae418`, rollback to `f7710d70-fe91-41ec-bf0a-342c7f88eb02`, and another SST run. The counter reached five without a reset or lost increment. The final SST run also preserved the rollback deployment ID. The native version API omitted `migration_tag` for the code-only candidate; the fixture permits that omission, rejects another tag, and compares the namespace ID and class before activation and after rollback.

This fixture alone omits the already-applied `v1` migration declaration when creating its SST-native inactive version. The normal artifact uploader now supports existing Durable Objects by inheriting the exact baseline bindings without sending migrations. It checks physical namespace/class identity and every other returned binding field. Namespace creation, deletion, renaming, or storage-schema changes remain infrastructure and compatibility operations.

The exact inherited-binding artifact path also passed on the same stage. Artifact `dacadf7db4d80bbb212c084024e16d71e4def30ff83e64062eb7f35bc8474531` uploaded as inactive version `164adda6-c166-498c-bdeb-c0754ebb1846` with the baseline's bindings. Provider download verified its compiled bytes. Activation, rollback, and another SST run preserved the namespace, and the counter reached ten. For a separately uploaded candidate, pass `--candidate-version <uuid>` and `--candidate-generation baseline` to the candidate drill because inherited public bindings retain the baseline label.

Upload reconciliation repeats binding verification before writing a receipt, including after a lost provider response. A changed namespace, bucket/queue target, configuration value, or migration tag cannot become a completed upload merely because its code bytes match. These checks do not authorize production mutation; the CLI's isolated-stage restriction remains.

Use a separate `release-proof-do-*` stage with a linked random `ReleaseProofToken`, supplied through SST stdin without a newline. Deploy first with `QUIETER_RELEASE_PROOF_PHASE=baseline`, record evidence in an empty directory, then deploy with phase `candidate` and run the candidate drill. Run SST once more in candidate phase, then verify the retained state:

```powershell
vp exec sst shell --config sst.release-durable-proof.config.ts --stage <isolated-stage> --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-durable-proof.ts --mode baseline --directory <absolute-evidence-directory>
# After the inactive candidate upload:
vp exec sst shell --config sst.release-durable-proof.config.ts --stage <isolated-stage> --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-durable-proof.ts --mode candidate --directory <absolute-evidence-directory>
# After the following SST run:
vp exec sst shell --config sst.release-durable-proof.config.ts --stage <isolated-stage> --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-durable-proof.ts --mode after-infrastructure --directory <absolute-evidence-directory>
```

The script checks both the request Worker's version and the executing object's version, and never retries an increment automatically. The local counterpart, `vp run @quieter/cloudflare#test:release-proofs`, uses native SQLite-backed Durable Objects and runs in CI. It verifies concurrent increments and authorization without cloud access. This proves provider behavior for compatible fixture code, not production mailbox contracts or arbitrary object migrations.

### Queue and scheduled trigger fixture

The isolated `release-proof-triggers-leander` drill passed on 2026-09-06. Candidate `2f15dea9-f50b-41e0-9d6f-155463017cd7` executed both triggers after activation; rollback restored `b6288a2a-7e39-4d6d-87c7-81058835ea7d` and both triggers executed it again. Each combined queue/scheduled sample completed within one minute. A following SST update disabled the schedule while preserving the rollback deployment ID, queue ID, and consumer ID, and another queue message executed the baseline. This proves the isolated trigger behavior, not the production handlers' contracts or Durable Object migration behavior.

`sst.release-trigger-proof.config.ts` creates a separate `quieter-release-triggers` application in a `release-proof-triggers-*` stage. It has a synthetic Worker, queue and DLQ, private R2 evidence bucket, and linked `ReleaseProofToken`. Supply that random token through SST stdin without a trailing newline. There are no application database, mailbox, or send-provider bindings.

Deploy with `QUIETER_RELEASE_PROOF_PHASE=baseline` and `QUIETER_RELEASE_TRIGGER_SCHEDULE=true`. Set the usual release account/stage variables and `QUIETER_RELEASE_BUCKET` from the journal output. Create an empty local evidence directory, then run:

```powershell
vp exec sst shell --config sst.release-trigger-proof.config.ts --stage <isolated-stage> --target ReleaseOperations -- node --conditions=development packages/deployment/src/verify-trigger-proof.ts --mode baseline --directory <absolute-evidence-directory>
```

Deploy again with phase `candidate`, then run the same verification command with `--mode candidate`. It first checks that inactive upload preserved the deployment and trigger identities, and samples both triggers on the baseline. It then activates the candidate, checks both triggers, restores the baseline, and checks both again. Queue evidence must arrive within two minutes; the scheduled check allows fifteen minutes for provider propagation. The script records an activation intent before mutation and attempts rollback on candidate-check failure. If that process dies, read its retained baseline version and actual provider state before repairing this isolated fixture; it is not the independent production recovery controller.

Finally keep phase `candidate`, set `QUIETER_RELEASE_TRIGGER_SCHEDULE=false`, and deploy once more. Run verification with `--mode after-infrastructure`. That requires an unchanged rollback deployment ID and queue consumer identity, checks another queue event, and verifies the fixture schedule is disabled. Preserve the small evidence records for review. No step deletes a queue or moves an existing production resource.

Read-only inspection on 2026-09-06 exported the encrypted production SST snapshot from 2026-09-05 at 22:16 UTC, containing 217 resources, and checked live runtime metadata. Production has six Workers using compatibility date `2026-08-04` and `nodejs_compat`. The realtime Worker owns a Durable Object migration tagged `v1`. The web Worker runs assets before code and does not yet have the new archive or version-metadata bindings. Its full secret set and existing resource identities must survive a reviewed ownership transition.

AWS confirms that all three current mail functions use unpublished `$LATEST` code and have no aliases. The receipt and feedback functions still receive direct SNS delivery. This is existing production behavior, not the new bridge design. Published versions, stable aliases, primary SQS buffers, health bindings, and archive bootstrap need protected infrastructure work before their runtime rollback paths can be enabled. This inventory changed no production resources.

## Controlled web builds

`vp run @quieter/deployment#build:web --directory <absolute-checkout> --output <new-absolute-directory> --stage <stage>` builds the web Worker once with task caching disabled. Use an ignored output directory or a directory outside the checkout. The checkout must be clean before and after compilation. Optional `--public-config <json-file>` accepts only the public settings validated by `@quieter/env`; inherited credentials, arbitrary Vite variables, Node hooks, and local dotenv files are excluded. The generated Wrangler configuration has no application bindings. Local development keeps its existing dotenv behavior.

The version-2 artifact records the Git commit/tree, lockfile checksum, actual Node/Vite+ toolchain, stage, public configuration checksum, build configuration checksum, and private source-map inventory. A completion manifest is written only after the copied bytes match their inventory and the source remains unchanged. Source maps use hidden references and live under `source-maps/`, outside both the Worker modules and public asset archive. S3 retention and restore verify them before completing. This is retention evidence, not proof of a Sentry upload; monitored production promotion still requires that separate gate. Version-1 historical artifacts remain readable.

The controlled build runs the pinned Sentry CLI's offline `sourcemaps inject` before inventorying any deployed bytes. It then checks every compiled JavaScript file against its retained map, including checksum, matching debug ID, embedded source content, and conflicting ID reuse. Injection requires no upload credential. The plugin's upload-disabled mode is insufficient here because the installed plugin fills map IDs during upload preparation; using it together with a second injector creates inconsistent identities. Implicit `.env.sentry-build-plugin` and `.sentryclirc` files in the build checkout are rejected.

Rolldown omits original-source maps for its generated runtime, the generated TanStack route manifest, and bare re-export shims. The build recognizes only those bounded generated forms and uses MagicString to map them to their actual generated source before debug-ID injection. Missing maps for application code still fail the build. These generated maps do not claim to recover an original TypeScript source that never existed.

On 2026-09-06 a controlled build passed the real web bundle checks, retained 316 modules, 172 static assets, and 437 private source maps in the isolated development release store, and restored all 925 files with matching hashes. A scan of those restored bytes found none of the local private configuration values. CI also passed the controlled build and artifact retention job on Linux.

CI now retains this exact build for fourteen days. A local build is useful verification but is not trusted CI authorization. The protected release workflow still needs to consume the successful trusted-main artifact, validate stage/configuration and source-map upload evidence, and retain it in the release journal before activation. The legacy SST workflow still rebuilds and has not been replaced yet.

### Source-map processing gate

`vp run @quieter/deployment#upload:source-maps --directory <absolute-artifact-directory> --receipt <new-absolute-json-path>` uploads only verified JavaScript/map pairs through the pinned Sentry CLI. The upload runs outside the checkout with an explicit destination, no inherited application credentials, and rewriting disabled. It waits up to two minutes for Sentry processing. A failed or interrupted upload leaves no success receipt; retrying uses the same immutable debug IDs. The CLI rechecks the original files after upload and conditionally retains a receipt in `<stage>/source-map-receipts/<artifact-digest>.json` in the release bucket. The local receipt is written only after that object is read back successfully.

Set `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_URL`, `QUIETER_RELEASE_STAGE`, `QUIETER_RELEASE_BUCKET`, and `AWS_REGION` explicitly. Upload credentials must come from the intended stage's linked SST `ReleaseSourceMapToken` secret. Raw `SENTRY_AUTH_TOKEN` configuration is rejected. For an isolated proof, enable `QUIETER_RELEASE_SOURCE_MAP_UPLOAD=true` in `sst.release-proof.config.ts` and run the command through `sst shell --target SourceMapOperations`. This target links only the upload secret and journal. Use the existing `quieter-staging` project for development evidence.

Controlled version-2 artifacts require a matching durable processing receipt during both promotion and rollback preflight. A receipt must match the artifact, build, number of JavaScript pairs, stage, organization, project, and Sentry region. Missing or conflicting receipts block before provider verification. Recovery needs the configured destination and receipt read permission but does not need the upload token. Historical version-1 proof artifacts remain readable; they do not establish controlled-build provenance for a production cutover.

Local tests cover missing evidence, interrupted uploads, stage mismatch, corrupted bytes, idempotent receipt retention, and wrong-project receipts. Live Sentry processing remains unverified until the existing staging upload credential is available.

### Trusted CI build reuse

`Build Runtime Release` runs the checks and controlled build from `main`, with no cloud credentials. Its public configuration must be set explicitly in the repository's `PRODUCTION_RELEASE_PUBLIC_CONFIGURATION` JSON variable. It uses the same six public settings accepted by the local builder. Review that value against production before enabling releases; changing it invalidates earlier builds. Pull-request checks retain their separate `ci` artifacts and cannot authorize production.

`Verify Runtime Build` accepts the successful build run ID. It checks out the independently pinned `RELEASE_CONTROLLER_SHA`, verifies the GitHub run's workflow, success, repository, main ancestry, and current attempt, and requires the uniquely named artifact from that attempt. The verifier hashes the actual archive download and requires GitHub's recorded SHA-256 digest. GitHub credentials are never forwarded to signed artifact storage. The pinned download action retrieves the selected immutable artifact ID. A second verification checks that selection again, validates source tree, lockfile and public configuration, and checks every extracted file and source-map pair. Unlisted files, symlinks, missing files, oversized trees, expired artifacts, or a rerun replacing the selection block verification.

The verification workflow has only repository and Actions read permissions. It writes evidence and outputs the verified source, artifact ID, and compiled digest. Runtime promotion must repeat these checks in its credential-free steps before using cloud access and bind the retained receipt to the release intent. Verification alone does not authorize activation. Both new workflows require `main`; they have not been run as trusted production workflows from this PR.

The verifier's `--retain` option repeats GitHub and downloaded-file verification, then conditionally writes `<stage>/trusted-build-receipts/<artifact-digest>.json` to the release bucket and reads it back. It requires the release storage configuration and a stage matching the build. The receipt preserves the repository, workflow run and attempt, immutable artifact ID and archive checksum, source tree, and configuration checksums. A retry preserves the first verified receipt. Ordinary promotion and manual rollback preflight require this retained evidence, so rollback does not depend on GitHub's fourteen-day artifact retention. Local proof callers must explicitly select proof mode; a stage name inside an artifact cannot waive CI verification. The read-only verification workflow does not request retention or cloud credentials.

On 2026-09-06, downloading an actual 16,271,145-byte PR artifact through GitHub's redirect endpoint matched its recorded archive digest. This verifies the transport mechanism only. The trusted-run checks deliberately reject that PR artifact. See [GitHub artifact metadata and downloads](https://docs.github.com/en/rest/actions/artifacts) and [workflow security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## Independent recovery configuration

`.github/workflows/release-recovery.yml` listens for release completion and reconciles every five minutes. `RUNTIME_RELEASE_RECOVERY_ENABLED` defaults off. Before enabling it, configure the `release-recovery` environment with a reviewed 40-character `RELEASE_CONTROLLER_SHA`, `RELEASE_STAGE`, `RELEASE_JOURNAL_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, and `AWS_REGION`. Supply `RELEASE_RECOVERY_AWS_ROLE` and `RELEASE_RECOVERY_CLOUDFLARE_TOKEN` with only journal/version/deployment permissions. The recovery job does not need application secrets, database access, migrations, or an SST deploy.

The CLI still refuses production mutations, including reconciliation. Production enablement requires the remaining cutover gates; setting a workflow variable alone cannot bypass them. Every writer must use the same `quieter-deploy-<stage>` mutation group. A completed writer with unfinished journal state is recoverable even if GitHub labels its run successful. An unavailable GitHub status or expired but still active writer blocks compensation and fails the recovery job visibly.

Read-only GitHub inspection found `Production` and `Review` environments with branch policies, and `Review` permits only `main`. There is no configured release-recovery environment or development AWS role in that environment. No branch protection, credentials, or permissions were changed to run the local provider proofs. Independent GitHub recovery still requires a reviewed environment and least-privilege access setup.
