# Release controller development

Milestone A is in progress. Production still runs the legacy SST workflow. `@quieter/deployment` currently rejects mutations outside isolated `release-proof-*` stages. Do not remove that restriction until the ownership, artifact, trigger, and recovery workflow gates in the [approved plan](mail-platform-reliability-plan.md) pass.

## Implemented

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

Read-only inspection on 2026-09-06 exported the encrypted production SST snapshot from 2026-09-05 at 22:16 UTC, containing 217 resources, and checked live runtime metadata. Production has six Workers using compatibility date `2026-08-04` and `nodejs_compat`. The realtime Worker owns a Durable Object migration tagged `v1`. The web Worker runs assets before code and does not yet have the new archive or version-metadata bindings. Its full secret set and existing resource identities must survive a reviewed ownership transition.

AWS confirms that all three current mail functions use unpublished `$LATEST` code and have no aliases. The receipt and feedback functions still receive direct SNS delivery. This is existing production behavior, not the new bridge design. Published versions, stable aliases, primary SQS buffers, health bindings, and archive bootstrap need protected infrastructure work before their runtime rollback paths can be enabled. This inventory changed no production resources.

## Independent recovery configuration

`.github/workflows/release-recovery.yml` listens for release completion and reconciles every five minutes. `RUNTIME_RELEASE_RECOVERY_ENABLED` defaults off. Before enabling it, configure the `release-recovery` environment with a reviewed 40-character `RELEASE_CONTROLLER_SHA`, `RELEASE_STAGE`, `RELEASE_JOURNAL_BUCKET`, `CLOUDFLARE_ACCOUNT_ID`, and `AWS_REGION`. Supply `RELEASE_RECOVERY_AWS_ROLE` and `RELEASE_RECOVERY_CLOUDFLARE_TOKEN` with only journal/version/deployment permissions. The recovery job does not need application secrets, database access, migrations, or an SST deploy.

The CLI still refuses production mutations, including reconciliation. Production enablement requires the remaining cutover gates; setting a workflow variable alone cannot bypass them. Every writer must use the same `quieter-deploy-<stage>` mutation group. A completed writer with unfinished journal state is recoverable even if GitHub labels its run successful. An unavailable GitHub status or expired but still active writer blocks compensation and fails the recovery job visibly.

Read-only GitHub inspection found `Production` and `Review` environments with branch policies, and `Review` permits only `main`. There is no configured release-recovery environment or development AWS role in that environment. No branch protection, credentials, or permissions were changed to run the local provider proofs. Independent GitHub recovery still requires a reviewed environment and least-privilege access setup.
