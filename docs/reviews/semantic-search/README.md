# Hybrid semantic-search verification

This change shares a versioned embedding adapter across personal memory recall, conversation history and retained mail. SQL source records remain authoritative. It replaces query expansion rather than keeping both paid retrieval paths.

## Architecture

- Personal recall retains instruction, balanced-category, exact-correspondent and keyword selection. Current-version vector matches add candidates and relevance; final authority and prompt budgets still apply.
- History search combines PlanetScale TIN BM25, PostgreSQL full-text matches and exact scoped pgvector similarity through reciprocal rank fusion. The full-text lane includes retained content whose chunks are still pending. It returns current source snippets and opens the canonical conversation or mail reader.
- `semanticEmbedding` has source foreign keys, one-of-source constraints, model identity, source revision, chunk ordinal, text and vector. Live-source joins exclude stale or inaccessible records. Source locks fence writes after inference. Transactional update triggers physically purge old chunks; deletes cascade.
- The selected identity is `openai/text-embedding-3-small:1024:v1`. Legacy vectors with unknown model identity remain inactive. Private provider routing, bounded inputs, reported cost and strict vector validation are required. Known provider costs settle before response validation; uncertain paid failures retain their reservation and abort the operation. Unknown outcomes without a usable provider generation ID require [single-reservation recovery](../../billing.md#recover-one-interrupted-ai-reservation) through the existing [protected workflow](../../../.github/workflows/ai-credit-recovery.yml); there is no timed automatic release.
- Durable requests bind each source kind to its requesting user and billing mailbox. Leased batches continue preparation, preserve retry backoff and periodically discover changed sources. Stopping background preparation removes that registration. A current batch may finish; a later explicit search can resume retained-content preparation.
- Source preparation holds the indexing lease; query embedding and retrieval can proceed while it is busy. Queries do not duplicate the owner's pending chunks or alter its token, and provider failures still propagate.

Searchable history is not automatically a lasting fact about a person. Chat indexing includes only user and assistant prose. It excludes tool payloads and system content. Mail indexing excludes drafts, spam and trash.

## Gmail coverage and preparation

Gmail initially contributes messages already retained by Quieter. Ordinary provider search continues to cover the full mailbox. **Prepare older mail** explicitly requests a historical scan and explains that preparing search uses AI balance.

The importer uses authorized Gmail reads and the canonical revision-guarded snapshot writer. It never changes provider state. Import checkpoints survive embedding failures, and confirmed missing messages are skipped. Search imports enqueue neither importance analysis nor memory learning. The UI distinguishes source preparation from historical import progress, reports partial coverage and polls status without making AI calls.

Canonical versioned mail metadata supplies decoded Gmail subjects and readable HTML fallback text for both providers. Bounded legacy repair compares the exact source before writing, preserves raw data and truncation evidence, and purges old chunks transactionally. Pending metadata remains incomplete in coverage and cannot expose raw MIME or HTML through results. Gmail results use the original provider timestamp and managed mail uses its sent timestamp.

Semantic chunking processes the complete canonical search text in bounded batches. The shared source projection collapses Unicode whitespace before hashing, counting and chunking, so blank passages cannot block a batch or create empty final chunks. Authoritative source text remains unchanged. A source counts as indexed only after all current chunks exist. Mail capture and HTML text normalization can themselves retain a bounded representation; those limits remain separate from embedding coverage. Repeated preparation does not restart a completed historical scan. Stopping its registration removes its checkpoint, so another historical scan requires another explicit request.

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

Focused verification passed 18 provider-boundary tests, three final-selection tests, six importer tests, sixteen real PostgreSQL lifecycle and isolation tests, four query-contention cases, and fourteen durable-queue integration tests. The final source, contention and canonical-capture run passed 24 tests. Red-first regressions reproduced blank embedding input, indexing conflicts, import dates, encoded subjects and HTML-only lexical misses. Real row-lock races verify that legacy metadata repair cannot persist stale text. Controlled vectors prove access, freshness, native query and concurrency behavior; they do not substitute for the live model-quality report. Migration checks and disposable forward replay passed with the native-search-compatible database image.

The broader run passed 2,020 tests with 491 configured skips, and the combined disposable-database selection passed 483 tests across 43 files. Those runs preceded the final known-cost parsing and search-import recovery corrections. The provider correction passed its focused 18-case suite. The search-import correction passed six regressions and the affected capture/importance suites, 59 tests in total.

The final mail-normalization change passed 93 affected integration tests before its last truncation-evidence correction. The final 24-case run includes that correction. No further schema migration is needed for the versioned metadata upgrade.

The full CI run exposed shared-database queue-test interference after the runner migration. The same two files failed different cases in parallel, then passed all 18 cases with file parallelism disabled. The database CI lane now serializes files while preserving their internal race tests and existing assertions.

Repository-wide local `vp check --fix` completed formatting, then its type-aware analysis process was killed by host memory pressure before source analysis. Targeted checks passed. The unchanged full lint/type configuration subsequently passed in [CI on 497c14c7](https://github.com/quieter-email/quieter/actions/runs/42314220142/job/128222790885), together with general tests, database integration, deployment safety and the web build. That code was synchronized with main. The [pull request checks](https://github.com/quieter-email/quieter/pull/499/checks) report the latest publication status.

[Actual application verification](actual-app-verification.md) used real embeddings and native source records, not a replacement page or mocked RPC. Desktop light and narrow dark screenshots cover results, source navigation, preparation progress and optional older-mail registration. The default dialog keeps the query and results visible; optional preparation controls live under **Search coverage**.

## Run locally

Use the [supported application startup and guarded evaluation instructions](../../ai-memory.md#local-operation-and-rollout). A current development OpenRouter credential comes from the existing `OpenRouterApiKey` SST Secret or approved ignored local configuration; no Workers AI or separate OpenAI credential is required. [OpenRouter embeddings](https://openrouter.ai/docs/api_reference/embeddings) execute remotely even when the database and Workers run locally.

Local background preparation remains disabled by default. With the supported Worker runtime running, use `vp run dev:trigger semantic-index <user-id> <mailbox-id> <memory|chat|mail>` for one authorized scope. A mail trigger advances older-mail import only after that import is requested. Do not use shared development or production targets for destructive replay tests.
