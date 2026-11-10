# Gmail processing latency

With a capture backlog, correct label classification and the verification code were both saved in **6.913 seconds on average**, across five fixed runs. Baseline codes completed in 0/5 runs, so there is no valid baseline completion time for that case. Measured November 10, 2026 against baseline `61aca2aa` and the implementation committed as `7a3241b1b`.

The harness executed actual notification discovery, message claims, automation, credit admission, model requests, encryption and persistence against the allowlisted development database. Gmail HTTP used synthetic messages. Success required the expected classification and decrypted persisted code. Each run owned an isolated user, team, mailbox, encrypted dummy credential and bounded subscription. Local billing bypass was disabled only in the harness child. Fixtures were cleaned afterward. There were five alternating baseline/fixed pairs per case, 30 trials total. Times begin at notification processing. The new-arrival clock begins when a distinct notification arrives after older processing has reached real model HTTP.

| Case | Version | Label mean, s | Code mean, s | Both median, s (range) | Correct codes |
| --- | --- | --: | --: | --- | --: |
| Warm history | Baseline | 6.020 | Deferred | Incomplete | 0/5 |
| Warm history | Fixed | 6.191 | 7.153 | 6.996 (6.900 to 7.750) | 5/5 |
| 12 older capture messages | Baseline | 9.955 | Deferred | Incomplete | 0/5 |
| 12 older capture messages | Fixed | 6.103 | 6.913 | 6.908 (6.716 to 7.108) | 5/5 |
| Fresh mail during older processing | Baseline | 71.406 | 67.909 | 71.217 (71.002 to 71.961) | 5/5 |
| Fresh mail during older processing | Fixed | 9.510 | 10.341 | 10.237 (9.969 to 10.687) | 5/5 |

All 30 label classifications were correct. Deferred baseline codes are incomplete outcomes, not zero-latency successes. Baseline new-arrival runs honored the actual 60-second busy retry returned by the processor. The fixed new-arrival mean of 10.341 seconds remains above the 10-second aspiration on this local setup. No execution deadline was imposed. Warm labeling showed no measurable improvement within run variation.

These timings measure saved classification in observation mode, not an applied Gmail label. They exclude SMTP arrival, deployed Pub/Sub/queue transport, real Gmail HTTP and browser propagation. Capture is deferred behind critical work and was not fully drained in the fixed backlog trials. Concurrent Node consumers shared the repository's single-connection local database pool. Database preparation and billing round trips limited observed concurrency; no overlapping model HTTP requests occurred in these measured runs. Fresh model requests nevertheless started before older critical processing finished in all five fixed new-arrival runs. The actual workerd queue adapter separately passed a stubbed database/provider proof of concurrent progress, early critical broadcasts and completion after caller disconnection. That proof contributes no latency numbers. A separate authorized real-Gmail read-only probe completed 5/5 full message reads. Full message fetching and normalization averaged 0.209 seconds, median 0.197, range 0.192 to 0.254. It performed no AI processing or Gmail writes. Successful extraction responses on both sides used `google/gemini-3.1-flash-lite`. The baseline nominally requested 2.5 and reached 3.1 through its established fallback; the fixed path pins the working model with spending ceilings and data-retention routing preserved.

All 30 ledger snapshots matched settled reservation costs to recorded usage, with zero open reservations and zero model HTTP errors. Formal model requests reported $0.012079 total provider cost. The [sanitized evidence](performance/gmail-processing-latency.json) contains every trial, correctness and deferral status, request counts, financial checks, actual extraction models, means, medians and ranges. Five samples per side do not justify p95 estimates.

The one-off source archive, `mail-processing-reproducer.zip`, is supplied with the local handoff. It contains no credentials, compiled bundles or private mail data. Extract it into a clean ignored `.scratch/mail-latency` directory in the checkout; preserve previous artifacts and the active task budget ledger. Use the existing approved development configuration and installed Vite+ dependencies. The harness refuses non-development databases, Gmail mutations, non-fixture Gmail tokens and unexpected external HTTP hosts.

```powershell
vp run env:doctor
vp node .scratch/mail-latency/build.mjs pipeline baseline-final
vp node .scratch/mail-latency/build.mjs pipeline fixed-final
vp node .scratch/mail-latency/compare.mjs warm
vp node .scratch/mail-latency/compare.mjs backlog
vp node .scratch/mail-latency/compare.mjs new-arrival
vp node .scratch/mail-latency/summarize.mjs
```

The baseline builder reads package TypeScript from the pinned commit; the fixed builder reads the checkout. The runner uses actual fresh/catchup consumers and honors returned wake times with the native adapter's whole-second rounding. It does not substitute a deployed-queue latency estimate. The ignored budget ledger retains the task's cumulative usage. The harness stops admitting requests near $0.80 to leave headroom below its $1 task budget; it never raises the development key's configured cap.
