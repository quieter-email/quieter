import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";

const [operation, slot, mode] = process.argv.slice(2);
if (
  slot === undefined ||
  !/^[a-z_][a-z0-9_]{0,57}$/u.test(slot) ||
  (operation !== "enable" && operation !== "verify") ||
  (mode !== "shared" && mode !== "sharded")
) {
  throw new Error(
    "Usage: mail-event-cutover <enable|verify> <slot> <shared|sharded> [gmail,maintenance]"
  );
}

const scopes = new Set(process.argv[5]?.split(","));
const url = getMigrationDatabaseUrl();
const target = assertMigrationExecutionAllowed(url);
const db = postgres(url, { connect_timeout: 10, max: 1, prepare: false });

try {
  const slots =
    mode === "sharded"
      ? [0, 1, 2, 3].map((shard) => `${slot}_${shard}`)
      : [slot];
  const healthy = await db<{ slot_name: string }[]>`
    select slot_name from pg_replication_slots
    where slot_name in ${db(slots)} and database = current_database()
      and active and invalidation_reason is null
      and (failover or ${target !== "production"})
  `;
  if (healthy.length !== slots.length) {
    throw new Error("The mail event relay replication feed is not active.");
  }
  if (operation === "enable") {
    await db`
      insert into "mailDispatchSettings" (key, enabled)
      values ('mail-dispatch-v1', true)
      on conflict (key) do update set enabled = true
      where not "mailDispatchSettings".enabled
    `;
  } else {
    const [state] = await db<
      {
        enabled: boolean;
        gmailReady: boolean;
        maintenanceReady: boolean;
      }[]
    >`
      select
        exists (select 1 from "mailDispatchSettings" where key = 'mail-dispatch-v1' and enabled) as enabled,
        exists (select 1 from "gmailSchedulerEnrollment" where key = 'gmail-mail-dispatch-v1' and "completedAt" is not null)
          and not exists (select 1 from "mailDispatchEvent" where payload->>'kind' = 'gmail-enrollment') as "gmailReady",
        not exists (select 1 from "mailDispatchEvent" where payload->>'kind' = 'maintenance-enrollment') as "maintenanceReady"
    `;
    if (
      !state?.enabled ||
      (scopes.has("gmail") && !state.gmailReady) ||
      (scopes.has("maintenance") && !state.maintenanceReady)
    ) {
      throw new Error(
        "Mail event delivery and enrollment must be ready before removing scans."
      );
    }
  }
} finally {
  await db.end();
}
