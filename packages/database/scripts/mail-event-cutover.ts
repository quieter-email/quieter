import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";

const [operation, scopesArgument] = process.argv.slice(2);
if (
  operation !== "enable" &&
  operation !== "disable" &&
  operation !== "verify" &&
  operation !== "verify-disabled"
) {
  throw new Error(
    "Usage: mail-event-cutover <enable|disable|verify|verify-disabled> [gmail,maintenance]"
  );
}

const scopes = new Set(scopesArgument?.split(","));
const url = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(url);
const db = postgres(url, {
  connect_timeout: 10,
  max: 1,
  onnotice: false,
  prepare: false,
});

try {
  const [legacy] = await db<{ hasSlots: boolean }[]>`
    select exists (
      select 1 from pg_replication_slots
      where database = current_database()
        and starts_with(slot_name, 'quieter_mail_dispatch')
    ) as "hasSlots"
  `;
  if (legacy?.hasSlots) {
    throw new Error(
      "Retire the old mail relay's replication slots before changing dispatch."
    );
  }
  if (operation === "verify-disabled") {
    const [state] = await db<{ safe: boolean }[]>`
      select
        not exists (
          select 1 from "mailDispatchSettings" where key = 'mail-dispatch-v1' and enabled
        ) as safe
    `;
    if (!state?.safe) {
      throw new Error(
        "Restore fallback scheduling and close the producer gate before removing mail dispatch."
      );
    }
  } else if (operation === "disable") {
    await db`
      update "mailDispatchSettings" set enabled = false
      where key = 'mail-dispatch-v1' and enabled
    `;
  } else if (operation === "enable") {
    await db.begin(async (tx) => {
      await tx`
        insert into "mailDispatchSettings" (key, enabled)
        values ('gmail-mailbox-lanes-v1', ${scopes.has("gmail")})
        on conflict (key) do update set enabled = excluded.enabled
      `;
      const activated = await tx`
        insert into "mailDispatchSettings" (key, enabled)
        values ('mail-dispatch-v1', true)
        on conflict (key) do update set enabled = true
        where not "mailDispatchSettings".enabled
        returning key
      `;
      if (activated.length === 0) {
        await tx`select enqueue_mail_dispatch_event('{"kind":"maintenance-enrollment"}'::jsonb)`;
      }
    });
  } else if (scopes.size > 0) {
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
