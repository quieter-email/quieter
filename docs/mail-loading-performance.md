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

[Local measurements](performance/mail-loading-latency.json) record paired HTTP and sync-stage results. They do not establish production latency or reproduce the reported five-second thread-opening delay.
