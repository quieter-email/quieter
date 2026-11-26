import postgres from "postgres";

import {
  assertMigrationExecutionAllowed,
  getMigrationDatabaseUrl,
} from "./database-url.ts";

const databaseUrl = getMigrationDatabaseUrl();
assertMigrationExecutionAllowed(databaseUrl);
const sql = postgres(databaseUrl, { max: 1, onnotice: false });

try {
  let cursor: { mailboxId: string; messageId: string } | undefined;
  let repaired = 0;
  for (;;) {
    const afterCursor = cursor
      ? sql`where ("mailboxId", "messageId") > (${cursor.mailboxId}, ${cursor.messageId})`
      : sql``;
    // oxlint-disable-next-line eslint/no-await-in-loop -- Each page commits before advancing the primary-key cursor.
    const [page] = await sql<
      { mailboxId: string; messageId: string; repaired: number }[]
    >`
      with page as materialized (
        select "mailboxId", "messageId"
        from "gmailCapturedMessage"
        ${afterCursor}
        order by "mailboxId", "messageId"
        limit 200
      ), legacy as materialized (
        select p.*, c.snapshot->'labelIds' as encoded,
          case when pg_input_is_valid(c.snapshot->>'labelIds', 'jsonb')
            then (c.snapshot->>'labelIds')::jsonb end as labels
        from page p join "gmailCapturedMessage" c using ("mailboxId", "messageId")
        where c."deletedAt" is null and jsonb_typeof(c.snapshot->'labelIds') = 'string'
      ), updated as (
        update "gmailCapturedMessage" c
        set snapshot = jsonb_set(
          jsonb_set(c.snapshot, '{labelIds}', legacy.labels),
          '{providerRevision}', to_jsonb(c."providerRevision")
        )
        from legacy
        where c."mailboxId" = legacy."mailboxId" and c."messageId" = legacy."messageId"
          and c."deletedAt" is null
          and c.snapshot->'labelIds' = legacy.encoded
          and jsonb_typeof(legacy.labels) = 'array'
        returning 1
      )
      select page.*, (select count(*)::int from updated) as repaired
      from page order by "mailboxId" desc, "messageId" desc limit 1
    `;
    if (page === undefined) {
      break;
    }
    repaired += page.repaired;
    cursor = page;
  }
  process.stdout.write(`Repaired ${repaired} Gmail capture label snapshots.\n`);
} finally {
  await sql.end();
}
