# Hybrid semantic-search verification

This change shares a versioned embedding adapter across personal memory recall, conversation history and retained mail. SQL source records remain authoritative. It replaces query expansion rather than keeping both paid retrieval paths.

## Architecture

- Personal recall retains instruction, balanced-category, exact-correspondent and keyword selection. Current-version vector matches add candidates and relevance; final authority and prompt budgets still apply.
- History search combines PlanetScale TIN BM25, PostgreSQL full-text matches and exact scoped pgvector similarity through reciprocal rank fusion. The full-text lane includes retained content whose chunks are still pending. It returns current source snippets and opens the canonical conversation or mail reader.
- `semanticEmbedding` has source foreign keys, one-of-source constraints, model identity, source revision, chunk ordinal, text and vector. Live-source joins exclude stale or inaccessible records. Source locks fence writes after inference. Transactional update triggers physically purge old chunks; deletes cascade.
- The selected identity is `openai/text-embedding-3-small:1024:v1`. Legacy vectors with unknown model identity remain inactive. Private provider routing, bounded inputs, reported cost and strict vector validation are required. Known provider costs settle before response validation; uncertain paid failures retain their reservation and abort the operation. Unknown outcomes without a usable provider generation ID require [single-reservation recovery](../../billing.md#recover-one-interrupted-ai-reservation) through the existing [protected workflow](../../../.github/workflows/ai-credit-recovery.yml); there is no timed automatic release.
- Durable requests bind each source kind to its requesting user and billing mailbox. Leased batches continue preparation, preserve retry backoff and periodically discover changed sources. Stopping background preparation removes that registration. A current batch may finish; a later explicit search can resume retained-content preparation.

Searchable history is not automatically a lasting fact about a person. Chat indexing includes only user and assistant prose. It excludes tool payloads and system content. Mail indexing excludes drafts, spam and trash.

## Gmail coverage and preparation

Gmail initially contributes messages already retained by Quieter. Ordinary provider search continues to cover the full mailbox. **Prepare older mail** explicitly requests a historical scan and explains that preparing search uses AI balance.

The importer uses authorized Gmail reads and the canonical revision-guarded snapshot writer. It never changes provider state. Import checkpoints survive embedding failures, and confirmed missing messages are skipped. Search imports enqueue neither importance analysis nor memory learning. The UI distinguishes source preparation from historical import progress, reports partial coverage and polls status without making AI calls.

Semantic chunking processes the complete retained text in bounded batches. A source counts as indexed only after all current chunks exist. Canonical mail capture can itself retain a bounded representation; source capture limits remain separate from embedding coverage. Repeated preparation does not restart a completed historical scan. Stopping its registration removes its checkpoint, so another historical scan requires another explicit request.

## Native database setup

Production uses [PlanetScale TIN with pgvector](https://planetscale.com/docs/postgres/search). Read-only inspection found pgvector 0.8.5 installed in `quieter_dev`, with TIN 1.0.1 and vectorscale 0.9.0 available but not enabled. This work did not activate either extension there. Retrieval uses exact vector distance within the authorized source set; vectorscale and approximate indexes are not part of the implementation or a measured speed claim.

Local and CI migration verification use [Lead](https://planetscale.com/blog/introducing-lead), the TIN-compatible test extension. The pinned [Dockerfile](../../../infra/docker/semantic-search-postgres.Dockerfile) built with PostgreSQL 17.11, Lead 1.0.6 and pgvector 0.8.6. Build it with `infra/docker` as the context, not the repository root. Lead verifies SQL behavior, not production TIN performance. The exact development TIN 1.0.1 library was not exercised.

The native-search and import-column migrations are marked `-- quieter:contract` because extension creation, invalidation triggers and required columns fall outside the existing ordinary additive allowlist. Review these statements before applying the protected production migration workflow, then deploy readers and Workers. No migration policy was weakened. No production migration, extension activation, mailbox operation or deployment was performed for these checks.

## Captured live evidence

- [Memory embedding evaluation](memory-embedding-live.json) completed all ten contracts and retrieved the scored fact in all four semantic probes. Eligible synthetic source scopes were fully prepared before scoring.
- [Provider response contract](provider-runtime-contract.json) records two finite 1024-dimensional vectors, successful status and actual usage cost. The provider returns the unqualified `text-embedding-3-small` identity for the selected model. Validation accepts that exact alias while rejecting other models. The artifact contains no credential or private source text.
- [Decision trail](decisions.tsv) records the implementation choices and their evidence.

The [earlier SQL and Supermemory reports](../memory-recall/README.md) remain unchanged. Their lexical misses and query-expansion observations describe earlier retrieval implementations. No new Supermemory run is implied by the embedding report. These finite cases do not establish general accuracy, final-answer quality, extraction truth, comparative cost or latency.

## Verification status

Focused verification passed 18 provider-boundary tests, three final-selection tests, six importer tests, nine real PostgreSQL lifecycle and isolation tests, and fourteen durable-queue integration tests. Controlled vectors in database tests prove access, freshness, native query and concurrency behavior; they do not substitute for the live model-quality report. Migration checks and disposable forward replay passed with the native-search-compatible database image.

The broader run passed 2,020 tests with 491 configured skips, and the combined disposable-database selection passed 483 tests across 43 files. Those runs preceded the final known-cost parsing and search-import recovery corrections. The provider correction has passed its focused 18-case suite; affected capture verification and final application/CI checks are still being completed.

Repository-wide local `vp check --fix` completed formatting, then its type-aware analysis process was killed by host memory pressure before source analysis. This is not a lint pass. Targeted checks on the changed implementation files passed. This document does not claim final CI or actual-application acceptance yet.

## Run locally

Use the [supported application startup and guarded evaluation instructions](../../ai-memory.md#local-operation-and-rollout). A current development OpenRouter credential comes from the existing `OpenRouterApiKey` SST Secret or approved ignored local configuration; no Workers AI or separate OpenAI credential is required. [OpenRouter embeddings](https://openrouter.ai/docs/api_reference/embeddings) execute remotely even when the database and Workers run locally.

Local background preparation remains disabled by default. With the supported Worker runtime running, use `vp run dev:trigger semantic-index <user-id> <mailbox-id> <memory|chat|mail>` for one authorized scope. A mail trigger advances older-mail import only after that import is requested. Do not use shared development or production targets for destructive replay tests.
