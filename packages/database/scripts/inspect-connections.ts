import postgres from "postgres";
import { Resource } from "sst";

try {
  const resource: unknown = Reflect.get(Resource, "DatabaseUrl");
  if (
    typeof resource !== "object" ||
    resource === null ||
    !("value" in resource) ||
    typeof resource.value !== "string" ||
    resource.value.length === 0
  ) {
    throw new Error("Missing database binding.");
  }
  const sql = postgres(resource.value, {
    connect_timeout: 10,
    fetch_types: false,
    max: 1,
    prepare: false,
  });
  try {
    const rows = await sql.begin("read only", async (transaction) => {
      await transaction`SET LOCAL statement_timeout = '5s'`;
      return await transaction`
        SELECT pid, state,
          EXTRACT(EPOCH FROM (now() - xact_start)) AS transaction_age_seconds,
          EXTRACT(EPOCH FROM (now() - query_start)) AS query_age_seconds,
          wait_event_type, wait_event,
          to_jsonb(pg_blocking_pids(pid)) AS blocking_pids,
          CASE
            WHEN (query ILIKE '%from "user"%' OR query ILIKE '%from user %')
              AND query ILIKE '%for update%'
              THEN 'account_row_lock'
            WHEN query ILIKE '%aiMemory%' THEN 'memory'
            ELSE 'other'
          END AS query_family
        FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY xact_start NULLS LAST, pid
        LIMIT 30
      `;
    });
    process.stdout.write(`${JSON.stringify(rows)}\n`);
  } finally {
    await sql.end({ timeout: 5 });
  }
} catch {
  process.stderr.write("Database connection inspection failed.\n");
  process.exitCode = 1;
}
