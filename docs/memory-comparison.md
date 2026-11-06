# Memory recall comparison

The comparison uses the shared synthetic scenarios in `packages/orpc/evals/memory-recall-scenarios.ts`. It measures retrieved source-concept coverage. It does not measure answer accuracy or establish a general provider ranking.

## Run against Supermemory Local

Start a separate loopback-only Supermemory Local instance with its own data directory and a capped development model credential. Use the provider's [self-hosting instructions](https://supermemory.ai/docs/self-hosting/overview) and [configuration reference](https://supermemory.ai/docs/self-hosting/configuration). Keep its API key in a private file. Do not use a real mailbox, the default personal store, or production credentials.

The verified configuration used server `0.0.9`, local `Xenova/bge-base-en-v1.5` embeddings, and `openai/gpt-4.1-nano` through an OpenAI-compatible endpoint. The Linux x64 binary came from the official `server-v0.0.9` GitHub release. Its SHA256 was `d7987ecbf2b024c6de9d167becbcfcaabce447169b41d6f56db86f87d5187984`. The local server is distributed under separate license terms; the public repository's MIT license does not cover its nonpublic engine source.

Run the chunk comparison without memory extraction:

```bash
vp node scripts/run-memory-comparison.ts \
  --base-url http://127.0.0.1:6767 \
  --api-key-file /private/supermemory/api-key \
  --service-version 0.0.9 \
  --embedding-model Xenova/bge-base-en-v1.5 \
  --extraction-model openai/gpt-4.1-nano \
  --task-type superrag \
  --quieter-report /tmp/quieter-memory-eval.json \
  --output /tmp/supermemory-chunks.json
```

The optional `--quieter-report` attaches matching cases from a completed canonical SQL evaluation. Each case retains its SQL metrics under `quieter`, while the baseline metadata retains its mode and configured expansion model. Missing cases and reports from another evaluation layer are marked explicitly. Pairing uses the shared scenario ID; an older report without a corpus digest cannot independently prove that its fixtures match. Produce it with `vp run memory:eval --output /tmp/quieter-memory-eval.json` against the guarded disposable database described in [AI memory](ai-memory.md#synthetic-recall-evaluation). The comparison does not run or modify Quieter databases itself.

Use memory mode for a selected full corpus when you also want extracted-memory and profile observations:

```bash
vp node scripts/run-memory-comparison.ts \
  --base-url http://127.0.0.1:6767 \
  --api-key-file /private/supermemory/api-key \
  --service-version 0.0.9 \
  --embedding-model Xenova/bge-base-en-v1.5 \
  --extraction-model openai/gpt-4.1-nano \
  --task-type memory \
  --scenario word-disjoint-semantic-recall \
  --quieter-report /tmp/quieter-memory-eval.json \
  --output /tmp/supermemory-flight-memory.json
```

Use `--resume-run-id` with an existing report's run ID to query the same corpus without ingestion. The runner checks that retained document text still matches the shared scenarios before scoring. An incomplete corpus or a changed fixture blocks the resumed run.

Memory mode can spend model credits for every document. Keep the provider cap unchanged and select a corpus that fits the available development budget. The default mode is `superrag`. Repeated `--scenario` options select comparable shared cases. Each run creates separate namespaces containing synthetic data; it never deletes existing namespaces. Stop only the local process you started after capturing the reports.

On constrained hosts, the verified supported controls are `SUPERMEMORY_INGEST_CONCURRENCY=1`, `SUPERMEMORY_LOCAL_EMBEDDING_BATCH_SIZE=1`, `SUPERMEMORY_LOCAL_EMBEDDING_POOL_SIZE=1`, and `SUPERMEMORY_LOCAL_EMBEDDING_WASM_THREADS=1`. Disable telemetry and update checks for isolated testing. A provider token authorization failure or an interrupted server is an execution failure, not evidence of poor retrieval.

## Interpret the report

Each source fact becomes its own document with a synthetic concept ID in metadata. Combining an entire fact collection into a few chunks would make the retrieval problem easier. The runner therefore preserves source granularity.

Chunk and memory searches use the scenario's unchanged query, ten returned records, and a 32,000-character cap on whole returned records. Profiles are fetched separately without a query. Quieter uses its canonical task policies, including a 28,000-character allowance for reply suggestions. The cap is not a tokenizer-aware equalization of retrieval work; compare actual returned sizes, and do not claim equal budgets when either cap changes the selected evidence.

Memory results map to source concepts through real document metadata or included document lineage. Profile IDs map through listed memories. This proves that retrieved information came from the relevant source; it does not prove every extracted assertion is correct. Unmapped records remain visible in the report. No hand-authored synonym scorer judges paraphrased answers.

A document reaching `done` proves chunk readiness. It does not prove that all memory extraction finished. The runner observes a stable nonempty memory count for bounded polling and retains this limitation. Positive source-lineage hits are observable; absent memory or profile hits remain `indeterminate`. In `superrag` mode, memory and profile lanes are `not-evaluated`.

The shared comparison includes recipient and general voice plus four semantic probes. Actor authorization, shared-mailbox grants, mailbox-specific label rules, forgetting, and live calendar truth remain application contracts. No client-side filtering is used to award Supermemory an equivalent security score. Tokens, costs, latency, extraction truth, and final-answer quality are unmeasured.

The local configuration differs from Supermemory's hosted proprietary extraction service. Small synthetic retrieval results cannot establish production accuracy, quality, cost, or speed superiority.

## Observed local run

On November 6, 2026, the complete `superrag` run ingested 171 individual documents across five isolated scenario namespaces. It retrieved both recipient/general voice concepts and the relevant source in all four semantic probes, including the German accessibility query. No memory-generation jobs ran in that lane. The report retains returned synthetic text and concept lineage.

The separate flight-only run processed all 31 source documents through memory extraction. Local service logs recorded 31 completed memory jobs and no failures. Its chunk, memory, and profile lanes each retrieved the relevant flight source. The namespace contained 81 extracted memories, so raw record counts are not comparable to our stored fact count. These observations do not establish extraction truth or graph performance on the other semantic topics.

An earlier graph attempt was interrupted when the local process disappeared during concurrent host memory pressure. It produced a blocked report and was excluded. The successful retry used a fresh isolated store and the supported single-concurrency controls. The owned service process tree was stopped after the reports were captured.

The captured Supermemory artifacts predate the per-case SQL pairing fix. Their baseline header is metadata only. Keep those raw artifacts unchanged; pair them with lexical and semantic SQL reports in a separately labeled offline summary. This avoids presenting a postprocessed document as another service run.
