# Context recall verification

These November 6, 2026 reports contain synthetic facts only. The shared corpus is `packages/orpc/evals/memory-recall-scenarios.ts`. The SQL loader is the real application path. Live query expansion used the configured `google/gemini-2.5-flash-lite` model through a capped development credential. Supermemory Local used server 0.0.9, local `Xenova/bge-base-en-v1.5` embeddings and `openai/gpt-4.1-nano` extraction. Configuration names identify the requested models, not independently verified provider routing.

| Run | Flight | Plant-based food | German accessibility | Focused work |
| --- | --- | --- | --- | --- |
| SQL lexical | Miss | Miss | Miss | Miss |
| SQL semantic trial 1 | Hit | Hit | Miss | Hit |
| SQL semantic final | Hit | Hit | Hit | Hit |
| Supermemory document chunks | Hit | Hit | Hit | Hit |
| Supermemory extracted memories | Hit | Not run | Not run | Not run |

The earlier multilingual miss is retained. These are finite observations, not accuracy estimates. The unchanged flight case was retrieved in both completed semantic trials. No fixture-specific synonyms or prompt tuning were introduced between those trials. Earlier runs that exceeded the test deadline were failures and are excluded from this table.

All ten Quieter ownership, applicability, expiry and edit-freshness contracts passed in the three recorded SQL runs. Supermemory application authorization is not scored. Its document lane ingested 171 separate source documents across five scenarios, including recipient/general voice. Its graph lane processed the complete 31-document flight corpus. The profile contained the flight source among all 31 source concepts, which demonstrates query-independent profile availability rather than semantic search.

Hit means the relevant synthetic fact appeared in Quieter context or its source-concept lineage appeared in Supermemory results. It does not establish that an extracted assertion or final answer is correct. The SQL fixtures deliberately give distractors higher salience to expose the category cutoff. Supermemory receives the same text and concept identities, not an equivalent imposed salience model. Retrieval models, extraction, result limits and task policies differ. Returned whole records are character-bounded; this does not equalize model tokens or work.

## Captured reports

- [SQL lexical](quieter-lexical.json).
- [SQL semantic trial 1](quieter-semantic-trial-1.json).
- [SQL semantic final](quieter-semantic-final.json).
- [Supermemory chunks](supermemory-chunks.json).
- [Supermemory flight memories and profile](supermemory-flight-memory.json).

These files preserve the captured output. The older Supermemory reports contain baseline metadata but did not attach Quieter cases. The table above joins the independently captured reports by shared scenario ID. The comparison command now attaches matching Quieter outcomes directly; the recorded service output has not been rewritten to imply another service run.

See [comparison setup and limitations](../../memory-comparison.md), [SQL evaluation instructions](../../ai-memory.md#synthetic-recall-evaluation), and the source/date [component previews](../../screenshots/memory-provenance/light-wide.png). The previews render the actual provenance component and shared styles in synthetic surrounding layout. Full application navigation was not verified because the development optimizer was killed during resource contention.

## Verification

- `vp test --maxWorkers=1` passed 1,997 tests across 232 files. Forty files and 468 tests skipped their configured integration or platform conditions.
- The explicit disposable PostgreSQL run passed 51 tests across the store, overview, context selection, semantic authority and lazy tool suites.
- Final controlled-transport comparison tests passed all 10 cases, including baseline pairing and resumed-corpus rejection.
- Changed-file format, lint and type analysis completed. Its comparison-test style/type findings were corrected and that file passed its final check.
- Import boundaries passed for 906 source files/manifests. AWS and Cloudflare handler bundle checks passed, including all five Cloudflare Workers.
- Repository-wide type-aware lint was killed before analysis on two attempts. Formatting completed, but the global lint/type gate is not verified. No source diagnostic was produced by those killed attempts.

Independent review found two consequential issues that were fixed before publication: continuation after uncertain paid inference and discarded per-case comparison data. Focused tests exercise both corrections. A separate cross-family audit review was unavailable within the configured consultation allowance; the independent final source/evidence review used the inherited model.

No production deployment, migration, account configuration change, or real mailbox operation was performed.
