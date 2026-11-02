# Memory overhaul verification

Verified on `feat/personal-memory` against `origin/main` at `15773ffe`.

| Check | Result |
| --- | --- |
| `vp check --fix` | Passed across 936 files. Three existing React Compiler warnings remain in unchanged compose, navigation and message-list components. |
| `MIGRATION_TEST_DATABASE_URL=<loopback fixture> vp test` | 172 files and 1,178 tests passed, including PostgreSQL integration tests. |
| `vp run db:check` | Migration folder, schema drift and additive safety checks passed. |
| `MIGRATION_TEST_DATABASE_URL=<loopback fixture> vp run db:test-migrations` | Clean migration chain, repeat application, baseline upgrade and billing repair checks passed. |
| `vp run check:boundaries` | Passed for 760 source files and manifests. |
| `vp run check:bundles` | Three AWS handlers and five Cloudflare Workers bundled successfully. |
| `vp run @quieter/web#build` | Web production build passed. Later settings scope changes were covered by the final typecheck and browser run. |
| `vp run env:doctor` | Local configuration isolation passed after setup and cleanup. |
| Development model check | Synthetic sent mail produced separate German/Alex and formal English/Blair style facts. A malicious received instruction did not modify the existing privacy instruction. Explicit chat addition intent was recognized. The successful calls cost $0.006605 in total. |
| Real settings UI with synthetic local account | Personal add, edit, search and permanent delete passed. Manual addition while learning was paused passed. Mailbox scope selection, addition and permanent deletion passed. Light, dark and narrow-width screenshots were inspected. |

The migration is `packages/database/drizzle/20261022234239_curved_spiral`. It adds bootstrap state, expiring generated-text fingerprints and text/category indexes. Existing vector storage remains inert for a later contract release. No production migration or deployment was performed.

The final independent review identified three additional cases, all fixed and covered by PostgreSQL or context-selection tests: relationship facts exhausting the prompt before category reservations, stale organization membership breaking settings, and private-mailbox transfers retaining an old owner's scan. Earlier reviews also drove manual-preference protection, deletion and lease fencing, deferred action hydration, accurate learning progress, and generated-writing provenance.

The live model initially declined to learn from observed outbound mail because human authorship was uncertain. Earlier attempts also exposed an invalid confidence scale. The prompts now explain provisional style facts and confidence separately from importance. The final successful output is recorded in `memory-model-sample.json`. This sample is functional evidence, not a statistical quality evaluation.

Generated text is recognized through mailbox-scoped fingerprints, including automatic signatures. Substantive edits and text generated outside quieter cannot be attributed perfectly. Calendar reads cover the connected primary calendar. Forgetting cancels older queued evidence and provider replay, but new evidence can establish a fact again. Shared-mailbox automation uses mailbox knowledge and does not borrow an administrator's personal profile.

Production memory query patterns were inspected through PlanetScale Insights. The connector could not read the development logical database; no live development data claim is made. Provider network mutations were not used in verification. Runtime behavior was exercised with synthetic local data in a disposable loopback PostgreSQL container, and temporary browser configuration was removed afterward.

Screenshots contain synthetic data only:

- `docs/screenshots/memory-overhaul/memories-light.png`
- `docs/screenshots/memory-overhaul/memories-dark.png`
- `docs/screenshots/memory-overhaul/memories-mobile-dark.png`
