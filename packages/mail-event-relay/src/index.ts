import { once } from "node:events";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

import { createMailEventRelayEnv } from "@quieter/env/mail-event-relay";
import { signMailPayload } from "@quieter/mail/updates";
import postgres, { PostgresError } from "postgres";
import { z } from "zod";

const batchSize = 100;
const retryDelayMs = 5000;
const eventIdSchema = z.uuid();
type RelayEnv = ReturnType<typeof createMailEventRelayEnv>;
type Partition = {
  publication: string;
  slot: string;
  shard?: number;
};

class RelayError extends Error {
  override name = "RelayError";
}

const logError = (slot: string, error: unknown) => {
  let detail = "Connection or delivery interrupted";
  if (error instanceof RelayError) {
    detail = error.message;
  } else if (error instanceof PostgresError) {
    detail = `PostgreSQL error ${error.code}`;
  }
  process.stderr.write(`[mail-event-relay] ${slot} ${detail}\n`);
};

const deliver = async (id: unknown, env: RelayEnv, signal: AbortSignal) => {
  const eventId = eventIdSchema.safeParse(id);
  if (!eventId.success) {
    await delay(retryDelayMs, undefined, { signal });
    throw new RelayError("Outbox event has an invalid ID");
  }
  let failure = "Dispatch request failed or timed out";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    signal.throwIfAborted();
    const body = JSON.stringify({
      eventId: eventId.data,
      expiresAt: Date.now() + 30_000,
      purpose: "mail-dispatch-event",
    });
    const signature = await signMailPayload(
      body,
      env.GMAIL_LIVE_SYNC_TOKEN_SECRET
    );
    try {
      const response = await fetch(env.MAIL_DISPATCH_URL, {
        body,
        headers: {
          "content-type": "application/json",
          "x-mail-signature": signature,
        },
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (response.status === 204) {
        return;
      }
      failure = `Dispatch returned HTTP ${response.status}`;
      await response.body?.cancel();
    } catch {
      failure = "Dispatch request failed or timed out";
    }
    await delay(1000 * 2 ** attempt, undefined, { signal });
  }
  throw new RelayError(failure);
};

const reconcile = async (
  sql: postgres.Sql,
  partition: Partition,
  env: RelayEnv,
  signal: AbortSignal
) => {
  const [clock] = await sql<{ cutoff: string }[]>`
    select timezone('UTC', statement_timestamp())::text as cutoff
  `;
  let createdAt = "-infinity";
  let id = "";
  for (;;) {
    signal.throwIfAborted();
    const rows = await sql<{ id: string; createdAt: string }[]>`
      select id, "createdAt"::text as "createdAt"
      from public."mailDispatchEvent"
      where ("createdAt", id) > (${createdAt}::timestamp, ${id})
        and "createdAt" <= ${clock.cutoff}::timestamp
        ${partition.shard === undefined ? sql`` : sql`and shard = ${partition.shard}`}
      order by "createdAt", id
      limit ${batchSize}
    `;
    for (const row of rows) {
      await deliver(row.id, env, signal);
      ({ createdAt, id } = row);
    }
    if (rows.length < batchSize) {
      return;
    }
  }
};

const consume = async (
  partition: Partition,
  env: RelayEnv,
  stop: AbortSignal
) => {
  const url = env.MAIL_EVENT_REPLICATION_URL.href;
  const options = {
    connect_timeout: 10,
    connection: { application_name: partition.slot },
    max: 1,
    onnotice: false as const,
    ssl: env.requireFailover,
  };
  const sql = postgres(url, {
    ...options,
    idle_timeout: 30,
    query_timeout: 10,
  });
  const session = new AbortController();
  const signal = AbortSignal.any([stop, session.signal]);
  const reconciliation = Promise.withResolvers<null>();
  const consumer = postgres(url, {
    ...options,
    publications: partition.publication,
    slot: partition.slot,
    // postgres.js creates a missing slot. Check before each connection, including reconnects.
    async socket(_options, host, port) {
      signal.throwIfAborted();
      const [result] = await sql<{ ready: boolean }[]>`
        select exists (
          select from pg_replication_slots
          where slot_name = ${partition.slot} and database = current_database()
            and plugin = 'pgoutput' and not temporary and not pg_is_in_recovery()
            and invalidation_reason is null and wal_status <> 'lost'
            and (not ${env.requireFailover} or failover)
        ) as ready
      `;
      if (!result.ready) {
        throw new RelayError(
          "Persistent replication slot is missing, invalid, or lacks failover support"
        );
      }
      const socket = createConnection({ host, noDelay: true, port, signal });
      try {
        await once(socket, "connect", { signal: AbortSignal.timeout(8000) });
      } catch (error) {
        socket.destroy();
        throw error;
      }
      // The driver accepts net.Socket. Its structural type omits net.Socket.end's overloads.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return socket as postgres.SocketLike;
    },
  });
  try {
    await consumer.subscribe(
      "insert:public.mailDispatchEvent",
      async (row) => {
        await reconciliation.promise;
        await deliver(row?.id, env, signal);
      },
      () => {
        process.stdout.write(
          `[mail-event-relay] ${partition.slot} Replication connected\n`
        );
      },
      (error) => {
        if (!signal.aborted) {
          logError(partition.slot, error);
        }
      }
    );
    await reconcile(sql, partition, env, signal);
    reconciliation.resolve(null);
    process.stdout.write(
      `[mail-event-relay] ${partition.slot} Startup reconciliation complete\n`
    );
    if (!signal.aborted) {
      await once(signal, "abort");
    }
  } finally {
    session.abort();
    reconciliation.resolve(null);
    await Promise.all([consumer.end({ timeout: 1 }), sql.end({ timeout: 1 })]);
  }
};

const supervise = async (
  partition: Partition,
  env: RelayEnv,
  signal: AbortSignal
) => {
  while (!signal.aborted) {
    try {
      await consume(partition, env, signal);
    } catch (error) {
      if (!signal.aborted) {
        logError(partition.slot, error);
      }
    }
    try {
      await delay(retryDelayMs, undefined, { signal });
    } catch {
      return;
    }
  }
};

const main = async () => {
  const env = createMailEventRelayEnv();
  const publication = "quieter_mail_dispatch";
  const slot = env.MAIL_EVENT_REPLICATION_SLOT;
  const partitions =
    env.QUIETER_MAIL_EVENT_RELAY_SHARDED === true
      ? [0, 1, 2, 3].map((shard) => ({
          publication: `${publication}_${shard}`,
          shard,
          slot: `${slot}_${shard}`,
        }))
      : [{ publication, slot }];
  const stop = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      stop.abort();
      // A stalled socket must not keep a replacement task from taking the slot.
      setTimeout(() => process.exit(1), 10_000).unref();
    });
  }
  await Promise.all(
    partitions.map(async (partition) => {
      await supervise(partition, env, stop.signal);
    })
  );
};

await main().catch(() => {
  process.stderr.write(
    "[mail-event-relay] Invalid startup configuration. Check relay settings and secret bindings.\n"
  );
  process.exitCode = 1;
});
