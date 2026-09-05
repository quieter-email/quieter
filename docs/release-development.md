# Release controller development

Milestone A is in progress. Production still runs the legacy SST workflow. `@quieter/deployment` currently rejects mutations outside isolated `release-proof-*` stages. Do not remove that restriction until the ownership, artifact, trigger, and recovery workflow gates in the [approved plan](mail-platform-reliability-plan.md) pass.

## Implemented

- A complete release map with artifact digests, binding generations, and dependency contracts.
- Compatibility checks for intermediate promotion states and retained producer contracts after rollback.
- Intent recorded before every pointer change, conditional journal updates, immutable checksummed checkpoints, and reconciliation of lost activation responses.
- Recovery from a separate process, drift detection across the entire map, quarantine of failed artifacts, and refusal to start over unresolved attempts.
- Two-minute authenticated health observation with explicit checks and actual version identity. Certification requires fresh evidence covering every service.
- Browser asset inventory, immutable uploads, byte/MIME verification, receipt written last, and repair from the same artifact. Receipts are excluded from public fallback.

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

The existing `WorkersScript` ignores changes during the candidate phase. `WorkerVersion` uploads the compiled module and linked bindings without activating it. The checked-in proof rejects unsupported binding types and Durable Object migrations rather than silently dropping them.

Set `QUIETER_RELEASE_BUCKET`, `QUIETER_RELEASE_STAGE`, `CLOUDFLARE_ACCOUNT_ID`, and `AWS_REGION` from the intended proof stage. The CLI uses AWS's credential chain and the existing `CLOUDFLARE_API_TOKEN`. Read configuration through `@quieter/env/deployment`.

```powershell
vp run @quieter/deployment#release status
vp run @quieter/deployment#release bootstrap --file <absolute-baseline-manifest>
vp run @quieter/deployment#release prepare --attempt proof-recovery --run 1 --file <absolute-candidate-manifest>
vp run @quieter/deployment#release promote --attempt proof-recovery
vp run @quieter/deployment#release recover --attempt proof-recovery --reason process_ended
```

Each command is a separate process. If a command fails, read status and actual provider state before continuing. Do not bootstrap over an existing journal or delete history to rerun a failed release. A failed recovery stays discoverable and blocks the next release. The final `rolled_back` state must match the original baseline version. The new deployment ID will differ because restoration itself creates a deployment.

## Evidence recorded on 2026-09-06

- Pinned SST 4.17.1 and Cloudflare Pulumi 6.15.0 created an inactive native version while preserving the exact active deployment ID.
- The provider rejects `modules.contentSha256` as read-only despite exposing it in its TypeScript input definition. Uploading the compiled bytes through `contentBase64` works and makes content changes visible to Pulumi.
- A real S3 connection reset left a durable `prepared` attempt. A fresh process read it, promoted the candidate, and another process restored the original Cloudflare version.
- A subsequent SST update in candidate mode changed neither the native version nor the restored active Worker. The candidate remained inactive after rollback.
- Unit tests cover interruption around journal writes, lost activation responses, stale writers, external drift, failed compensation, quarantined artifacts, incompatible contracts, archive repair, corruption, and missing objects behind a valid receipt.

These tests establish the controller and basic linked Worker behavior. They do not yet establish TanStack asset upload behavior, protected production previews, queue/scheduled/DO version selection, production ownership transfer, or the independent recovery workflow. No production pointer, secret, or database was changed by this proof.
