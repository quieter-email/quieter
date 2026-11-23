# Mail loading performance

Authenticated RPC responses expose numeric `Server-Timing` entries in the browser's Network panel:

| Entry | Measured work |
| --- | --- |
| `rpc` | Web RPC handling, including router loading, authentication, the operation, and response creation |
| `session` | Session lookup and any required account repair |
| `mail_authorization` | Gmail credential authorization before the first provider operation |
| `mail_provider` | A Gmail operation, including response reading and conversion |
| `mail_metadata` | Importance and unsubscribe enrichment after the provider response |

These intervals overlap. Do not add them together. A retried provider operation can produce multiple `mail_provider` entries. The headers contain no mailbox identifiers, message content, or addresses. They do not measure browser rendering or the network transfer to the browser.

Compare the first uncached thread request after idle with subsequent requests. Check when the request starts, its response timing entries, and when the body becomes visible. Large threads, drafts, and externally stored body parts can require more provider work than a single message.

Mail update connections remain active while the page is online, including hidden and unfocused pages. Arrival events refresh observed queries through the existing coalescing path. Hidden pages do not gain periodic polling. Browsers can freeze or discard pages, so returning to a visible page still triggers reconciliation.

Inbox refresh publishes the first fresh page before fetching its continuation. One owner per mailbox, category, and search rejects superseded responses. Incomplete pages retain the old history checkpoint, cannot be persisted, and temporarily withhold pagination. Failure restores the withheld continuation. The mounted live-sync owner also replaces the generic stale-restore refetch, avoiding duplicate startup work.

Fresh pages replace only the refreshed prefix. Already loaded tail pages stay behind it, duplicate rows are removed at the boundary, and the list keeps its scroll anchor when rows are inserted or removed above the viewport. A deeply scrolled list therefore no longer collapses to the first refreshed page. Loaded message details and optimistic actions survive the replacement. Selected conversation state remains independent of the list.

Switching category or starting a search can seed the new view from messages already loaded for that mailbox. Unread views filter loaded unread conversations, and simple text or supported filter searches match loaded metadata. The provisional rows are view-only, are not persisted, and are replaced by the server result. Unsupported server-only search semantics wait for the server instead of showing a partial guess.

Thread preloading uses the existing mailbox-scoped query and persistent body cache. It admits at most ten current visible candidates, runs two speculative reads, and reserves another slot for intent. Scrolling and mailbox changes replace queued candidates. Direct opening shares an existing request without waiting for the preload queue. Hidden, offline, data-saving, and slow connections pause speculation. This bounds concurrency and queued work, although browsing more conversations still transfers more bodies. The existing 100MB cache budget remains unchanged.

[Local measurements](performance/mail-loading-latency.json) record paired HTTP and sync-stage results. They do not establish production latency or reproduce the reported five-second thread-opening delay.

## Synthetic component measurements

Round two used real Chromium with synthetic data and warm OS caches. Five alternating baseline and candidate pairs measured cache activation through the real `createMailCache().setUser()` method. A separately timed body read checked that the stored value remained readable. Payload sizes exclude metadata and storage overhead.

| Fixture | Baseline activation median and range | Candidate activation median and range |
| --- | --- | --- |
| Empty | 2.3ms, 2.1 to 2.4ms | 2.2ms, 2.1 to 2.4ms |
| 1,000 values, 10MB | 394.5ms, 380.8 to 505.8ms | 15.6ms, 13.2 to 27.4ms |
| 10,000 values, 95MB | 3,594.7ms, 3,458.3 to 3,813.2ms | 125ms, 106.2 to 142ms |

These measurements cover local cache activation, not full application loading. All body reads were valid, and metadata and value counts matched each fixture. At 10,000 values, median body read time was 1.5ms before and 1.4ms after.

A separate full development app reload experiment used the demo UI with the same 10,000-entry, 95MB synthetic cache. Five alternating pairs changed only `mail-cache.ts`. Median time to the first mail row fell from 5,864.3ms to 2,193.6ms. Ranges were 5,747.2 to 6,672.4ms before and 1,832.1 to 2,351.1ms after. Every reload reached a row with zero observed window errors. The first cache transaction accounted for most of the difference. This Vite development result includes startup and UI work, but uses warm browser and OS caches and does not represent production Gmail loading.

A separate untimed operation probe observed 20,000 cursor continuations and 10,000 count calls in the baseline. The candidate used one metadata `getAll` and one value-key `getAllKeys`. Both methods inspect persisted cache ownership. The candidate avoids a request for each entry without loading stored bodies. Identity-switch cleanup and draft recovery need their own behavioral checks.

The refresh timing experiment injected provider delays of 100ms, 400ms, and 400ms into the real refresh function under fake timers. Across five alternating pairs, first fresh publication changed from 900ms to 100ms. Every run still made three requests and completed at 900ms with three final messages and zero errors. This proves earlier publication under those injected delays. It does not measure production latency or reduce total provider work.

The synthetic HTML experiment removed a repeated preference transformation. Its local median changed from 48.9ms to 36.7ms across five pairs. Ranges were 46.3 to 54.8ms before and 34.4 to 51.2ms after. Every run retained 400 headings and identical text and processed HTML lengths, with no remote image sources. The roughly 12ms saving excludes layout, paint, RPC, and full component mounting. The JSON artifact preserves the raw samples and experiment boundaries.

Production verification remains incomplete. No matching production Sentry spans were available. Observed SQL execution p99 below 70ms excludes network round-trip time. The available Cloudflare token listed no Workers, so Worker traces were unavailable. These observations do not establish the cause or resolution of the reported production delay.

## Repeat the cache experiment

Run from the repository root.

```bash
vp exec node scripts/mail-cache-benchmark.mjs
```

The script reads the baseline with `git show 85b9d05d:packages/app/src/lib/mail-cache.ts` into a temporary directory. It imports the current workspace module directly. It starts a Vite server on an unused loopback port with explicit `idb` and `zod` aliases. It does not load environment files or contact application services.

Open the printed URL in a separate browser profile. In its developer console, run the following command.

```js
await runMailCacheBenchmark();
```

The result contains raw samples, record counts, and an error count for each fixture. Invalid reads or changed counts throw an error. For a smoke run, use `await runMailCacheBenchmark([[0, 0], [10, 100]], 1)`. Each call creates uniquely named synthetic databases on this isolated origin. Clear that origin's site data after closing the page to remove the synthetic databases. Press Ctrl-C to stop the owned server and remove its temporary source files.

Use five pairs for comparisons. Record browser version, host load, and core count with each new result. This benchmark seeds data before timing and reuses persisted data between samples. It measures warm activation and body access, not cold disk startup, browser login, network latency, or rendering. The candidate is the working tree at run time, so preserve its commit or diff with any published result.
