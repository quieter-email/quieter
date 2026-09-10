# Mail sync cost model

Decision recorded September 10, 2026: provide live Gmail sync on all plans and limit Gmail connections to 5 / 25 / 100 per team on Free / Managed / Pro. These are capacity limits, not per-member allowances. Paid AI is metered separately.

## What drives cost

Pub/Sub carries small change notifications. Provider API calls, database projection writes, retained bodies, command processing and recovery determine most of the work. Hibernating sockets do not consume idle Durable Object duration. Each user has a logical object, not a permanently running server. Native ping auto-responses avoid waking its handler. Our two-minute access and subscription maintenance still performs work while sockets are open.

When every tab is hidden for 30 seconds, the client closes its connection and stops fallback polling. Returning tabs replay missed changes. Server ingestion continues while tabs are closed; Free users therefore still incur ingestion and storage costs. Quiet Gmail mailboxes receive a recovery check every 15 minutes. The every-minute worker sweep selects due jobs rather than fetching each mailbox every minute.

| Illustrative mailbox activity              | Monthly events over 30 days |
| ------------------------------------------ | --------------------------: |
| Manual refresh 10 times daily              |               300 refreshes |
| Refresh every 30 seconds for 8 hours daily |               28,800 checks |
| Push with 100 change notifications daily   |         3,000 notifications |
| 15-minute recovery throughout the month    |                2,880 checks |

Push reduces empty refreshes for an actively open client, but manual-only operation can be cheaper for rarely used mailboxes. These event counts are not equivalent units of CPU or database cost. Notification bursts can be coalesced, and history pagination, mailbox size and AI activity change the work per event. Initial archive import must be accounted for separately.

## Pricing references

At the time of this decision, [Google Pub/Sub basic throughput](https://cloud.google.com/pubsub/pricing) includes the first 10 GiB monthly, then charges $40/TiB. Both publishing and delivery count, with a minimum 1 KiB request. The example of 3,000 small notifications is roughly 6 MiB of publish plus delivery throughput, about $0.00022 before the free allowance. This excludes transfer, retention, retry overhead and all application processing.

[Cloudflare Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) separately meters requests, active duration and SQLite operations. Hibernation removes idle duration, not delivery or maintenance work. Native WebSocket auto-responses do not wake the object. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) adds the account plan, request and CPU charges. Shared included allowances mean a marginal price is not an all-in cost per user.

[Gmail quotas](https://developers.google.com/workspace/gmail/api/reference/quota) assign different weights to operations. Google has also announced [Workspace API billing changes](https://developers.google.com/workspace/tools-safety); do not assume API access remains unconditionally free. Check project quotas and current billing notices before setting a long-term operating budget.

Use aggregate queue age, command age, object storage, database activity and actual provider bills to refine this model after deployment. Hard benchmarking was deferred. This document does not claim measured production unit costs.
