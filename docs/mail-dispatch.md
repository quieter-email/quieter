# Mail event dispatch

Postgres writes mail events in the same transaction as the job or mailbox change. After the request finishes, the application sends Cloudflare the event IDs collected from PostgreSQL notices in batches. Larger writes remain durable in the outbox. The web Worker sends this wake in `waitUntil` so it can return the response while dispatch runs. The wake carries IDs and an expiry, signed with the linked Gmail live-sync secret. The dispatch Worker reads only committed rows for those IDs.

The Worker validates the signed request and accepts it with HTTP 202. It handles delivery under its own request lifetime and leases each row before sending the wake to the mailbox or maintenance scheduler. It deletes an event after durable acceptance. Transport failures leave the event eligible when its short lease expires. Delivery may repeat following an interrupted acknowledgment, so the schedulers merge repeat wakes and the browser tracks mailbox versions. Invalid events are reported and removed.

A Cloudflare Cron Trigger checks the outbox's due-time index every five minutes. It covers a crash between commit and wake, contention, and a producer that cannot send the immediate wake. It claims one indexed batch per partition. A full batch queues a continuation for that partition so a backlog can keep draining between checks. Four recovery consumers bound the extra database pressure during a burst. Direct wakes can still reach the dispatcher while recovery runs. An empty check does not submit queue messages. Gmail reconciliation and timed jobs continue on their own mailbox or maintenance alarms. The dispatcher connects through regular Hyperdrive requests and needs no replication slots or long-lived consumer.

## Local verification

Use disposable PostgreSQL on loopback for tests that create or reset fixtures. Run `vp run db:migrate`, then use an ignored `.env.local` containing `MAIL_DISPATCH_URL=http://127.0.0.1:8787/mail/dispatch/event` and the normal local signing key. Start `vp run dev:workers` with Gmail in observe mode. Enable the database gate using `vp exec node --env-file=.env.local packages/database/scripts/mail-event-cutover.ts enable gmail`. Omit `gmail` if Gmail mailbox lanes are unavailable.

Run `vp run dev:trigger mail-dispatch` to process the enrollment and to exercise the same repair as the deployed Worker. Write an expiring rate-limit row through the local application and observe the signed wake followed by cleanup after the alarm. Roll back a write and verify no event commits. To test recovery, commit a row using a plain SQL client. That client sends no wake. Run the repair trigger and verify that the retained event is accepted and the cleanup still happens.

## Hosted rollout

1. Set `QUIETER_MAIL_DISPATCH_ENABLED=true` and deploy with both scan-removal flags off. After the signed deployment check passes, run **Administer production mail dispatch and capture** with `enable-dispatch` to open the database gate and record the enrollment events.
2. The deploy verifies that Hyperdrive forwards notices to the mail updates Worker and the resulting signed dispatch reaches the database. With both fallbacks running, confirm the outbox drains and both enrollments finish. The deploy preflight checks enrollment and checks for stale outbox entries before turning off the old scans.
3. Set `QUIETER_GMAIL_EVENTS_ENABLED` and `QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED` for the scans you intend to retire. Allow older executors to drain before retiring their resources. If you enable encrypted storage later, rerun the protected activation after old capture writers finish to schedule legacy body backfill.
4. To revert, restore the old schedules and confirm they have taken over. Run **Administer production mail dispatch and capture** with `disable-dispatch` and confirm the fallback schedules are live to close the producer gate. Then remove the dispatch Worker in a subsequent deploy. The preflight also checks for any replication slots from a pre-release installation of the previous relay.

Watch dispatch failures and the age of the oldest pending event. The five-minute repair bounds recovery delay in ordinary operation. A prolonged outage or backlog can take longer to clear.

```sql
SELECT shard, min("createdAt") AS oldest_pending_utc, count(*) AS pending
FROM "mailDispatchEvent"
GROUP BY shard;
```

## Capacity and costs

At idle the repair trigger runs 288 times per day and performs four indexed claims each time. Queue continuations run only for full batches or enrollment. When measuring capacity, check how quickly a backed-up mailbox or partition drains while new traffic continues. Track oldest pending events, dispatch errors, and Postgres connections and query latency. [Cloudflare queue pricing](https://developers.cloudflare.com/queues/platform/pricing/) · [Hyperdrive limits](https://developers.cloudflare.com/hyperdrive/platform/limits/)

Gmail provider capacity is shared by active mailboxes. The default 600,000-unit background budget reserves separate capacity for live work, catch-up, and watches. Actual throughput depends on the mix of Gmail calls and available project quota. A quiet mailbox with healthy watches uses roughly 144 quota units per day for the current reconciliation and renewal schedule. Use the project’s actual quotas and watch-expiry margins to plan growth. [Gmail API quotas](https://developers.google.com/workspace/gmail/api/reference/quota) · [Gmail watch renewal guidance](https://developers.google.com/workspace/gmail/api/guides/push)
