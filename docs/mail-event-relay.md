# Mail event relay

The relay streams committed inserts from `public."mailDispatchEvent"`. It posts the event ID, purpose, and a 30-second expiry to the Mail Dispatch Worker. It signs the raw JSON with the Gmail live-sync signing key. The Worker returns HTTP 204 after accepting the work durably and deleting the outbox row. It also returns 204 for an already removed row. Invalid payloads are reported and removed so they cannot stall the feed. Service and transport failures leave their rows available for retry. PostgreSQL confirms a transaction after all its published events return 204. A retry, a restart, or an interrupted response can deliver the same ID again.

On startup, each consumer opens replication before scanning the outbox. It replays rows in pages of 100 up to a database timestamp captured after the connection opens. That pass recovers rows written before slot creation. New commits remain on the stream. If a consumer falls behind, it reads a bounded batch from its partition and delivers those rows concurrently. The WAL checkpoint still advances in commit order. Failed requests get three attempts, each with an eight-second timeout and a fresh signature. A failed streaming callback rejects and postgres.js reconnects from the persisted slot position. A failed reconciliation restarts that partition and scans the remaining rows again.

## Local startup

Use a disposable PostgreSQL 17 or newer server on loopback and a local Mail Dispatch Worker or an HTTP receiver that verifies the raw-body signature. A receiver used to exercise reconciliation should delete the requested row before returning 204.

Set `wal_level=logical`. Apply the outbox migration, or create the following fixture on a fresh disposable instance.

```sql
CREATE TABLE public."mailDispatchEvent" (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  payload jsonb NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT timezone('UTC', now()),
  shard integer NOT NULL DEFAULT 0
);
CREATE PUBLICATION quieter_mail_dispatch
  FOR TABLE public."mailDispatchEvent" WITH (publish = 'insert');
SELECT pg_create_logical_replication_slot('quieter_mail_dispatch_local', 'pgoutput');
```

Put the following values in the ignored `.env.mail-event-relay.local` file at the repository root. Match the port and signing key to your local services.

```dotenv
MAIL_EVENT_REPLICATION_URL=postgres://postgres@127.0.0.1:5432/postgres
MAIL_EVENT_REPLICATION_SLOT=quieter_mail_dispatch_local
MAIL_DISPATCH_URL=http://127.0.0.1:8787/mail/dispatch/event
GMAIL_LIVE_SYNC_TOKEN_SECRET=local-mail-dispatch-signing-key
```

Run `vp run dev:mail-event-relay` in a dedicated terminal or under a process supervisor. Wait for `Replication connected` and `Startup reconciliation complete`. Stop it with Ctrl+C and use the same slot name to resume. Use your own slot and database when several local relays are running.

For a manual check, begin a transaction and insert a fixture row. Confirm that the receiver sees the ID only after `COMMIT`. Repeat with `ROLLBACK` and confirm the receiver sees no request. Make the receiver return 503 for another committed ID. Wait for the relay to report the failure and confirm the slot has not advanced past that transaction. Stop the relay, restore HTTP 204, and restart with the same slot. Confirm that it delivers the ID and advances the slot. Remove the disposable database after stopping your local relay.

## Hosted prerequisites

Enable the service via `QUIETER_MAIL_EVENT_RELAY_ENABLED=true` in the protected deployment environment after the database and endpoint are ready. Hosted deploys default to four consumers. Each reads the publication with the matching suffix `_0` through `_3` and uses its own persistent slot with the same suffix. A failed wake stalls its partition while the others continue. Set `QUIETER_MAIL_EVENT_RELAY_SHARDED=false` to use the single `quieter_mail_dispatch` publication. For an authorized nonproduction SST preview or deployment, run `vp run @quieter/env#build` and `vp run @quieter/mail-event-relay#build` first. The protected deployment workflow builds the relay before preview.

- Apply the outbox migration and confirm the selected publication or publications are present and publish INSERT only. For sharded mode, verify that the four publication row filters cover shards 0 through 3 without overlap.
- Configure the stage's SST `MailEventReplicationUrl` secret with a direct primary PostgreSQL URL on port 5432. The runtime role needs LOGIN, REPLICATION, CONNECT, schema USAGE, and SELECT on the outbox for startup reconciliation. Use a stage-specific role and verify PlanetScale grants and branch network access before opting in.
- Ensure the stage's `GmailLiveSyncTokenSecret` matches the deployed Worker. The deployment passes the full HTTPS endpoint as `MAIL_DISPATCH_URL`. SST supplies secrets to ECS through encrypted Parameter Store bindings.
- Enable logical WAL on PlanetScale and confirm `hot_standby_feedback` and `sync_replication_slots` are enabled. Precreate one permanent `pgoutput` slot per active publication in the target database with failover enabled. PlanetScale detects those slots automatically. See [PlanetScale failover slots](https://planetscale.com/blog/how-to-make-a-replication-slot-survive-a-cutover) and [slot registration](https://planetscale.com/changelog/postgres-logical-slots-no-registration).
- The service uses one small Fargate task in public subnets, without a load balancer or NAT Gateway. The task has a public IPv4 address for outbound traffic and the VPC security group blocks internet ingress. Confirm the stage's deploy role can provision the VPC, ECS, ECR image, CloudWatch logs, and encrypted SSM parameters. The task address can change on replacement. A database that requires fixed source IPs needs an approved egress path before this topology can be used.

The hosted slot base is `quieter_mail_dispatch_<stage>`, with the stage lowercased and hyphens replaced by underscores. For example, run the following on the production primary to initialize the **single-consumer** layout through the approved database workflow. For sharded production, create `quieter_mail_dispatch_production_0` through `quieter_mail_dispatch_production_3` instead.

```sql
SELECT pg_create_logical_replication_slot(
  'quieter_mail_dispatch_production', 'pgoutput', false, false, true
);
```

Review the ECS service and CloudWatch logs for a replication connection and completed reconciliation for every configured slot. Verify a representative durable handoff and the slot's position. For PlanetScale HA, confirm the slot is synchronized and promotion-ready after it advances. Keep the database producer gate `mailDispatchSettings` entry `mail-dispatch-v1` disabled until the slot and relay are ready. Enabling the SST service does not change that entry.

For the cutover, first deploy the relay with both scan-removal flags off. Run the protected SST deployment with `activate_mail_event_dispatch` to open the producer gate. That transaction records the Gmail and maintenance enrollment events. The local equivalent is `vp exec node --env-file=.env.local packages/database/scripts/mail-event-cutover.ts enable <slot> <shared|sharded> [gmail]`. Pass `gmail` when the stage has Gmail mailbox lanes, so general maintenance skips work they own. Use the actual replication slot base. Check that enrollment and delivery have caught up, then select `QUIETER_GMAIL_EVENTS_ENABLED` and `QUIETER_MAIL_MAINTENANCE_EVENTS_ENABLED` for the scans you intend to remove. The deployment preflight checks the feed and the corresponding enrollment before disabling a schedule. Allow the previous version's in-flight jobs to drain. If you enable encrypted capture later, rerun the protected activation after old capture writers finish. It schedules maintenance enrollment again, including the legacy body backfill.

Keep per-mailbox Gmail history reconciliation and watch deadlines in the scheduler. Quiet accounts need those deadlines because Gmail can drop notifications or let a watch expire. The remaining maintenance deadlines arm only for pending work. If reverting, first restore the old schedules and verify that they have taken over. Close the producer gate and retire the stage's replication slots before removing the relay. The protected deploy stops if the gate or any of those slots is still present.

## Monitoring and recovery

Monitor the ECS task count and restart events, per-slot errors in the relay log, the oldest pending outbox row, and WAL retained by each slot. The last two distinguish an idle stream from missed delivery. Use the branch's primary database to inspect the slots.

```sql
SELECT slot_name, active, failover, wal_status, invalidation_reason,
       pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn) AS retained_wal_bytes,
       confirmed_flush_lsn
FROM pg_replication_slots
WHERE slot_name LIKE 'quieter_mail_dispatch%';

SELECT shard, min("createdAt") AS oldest_pending_utc, count(*) AS pending
FROM public."mailDispatchEvent"
GROUP BY shard;
```

ECS replaces a stopped task and deploys updates one task at a time. Preserve the slot names across deployments. After a secret rotation, replace the task so ECS reads the new Parameter Store versions. Plan a controlled handoff before switching between single and sharded layouts. Every inactive slot retains WAL. Monitor retained WAL against available database storage and investigate repeated delivery failures before the slot is invalidated.

A missing or invalid slot prevents the affected consumer from connecting. Stop the affected relay and review the producer gate, retained outbox, and slot state before approving a new checkpoint. Precreate the replacement slot and let the startup scan deliver the pending rows. Drop an obsolete slot only after its replacement or the fallback dispatch path is verified, the retired consumer is stopped, and the operator approves releasing its WAL.
