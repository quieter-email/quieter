import type { DatabaseClient } from "@quieter/database/client";
import { tables } from "@quieter/database/schema";
import { getTableColumns, sql } from "drizzle-orm";

export const assertReviewDatabaseSchema = async (client: DatabaseClient) => {
  const tableChecks = Object.entries(tables).map(([name, table]) => {
    const columns = Object.values(getTableColumns(table)).map((column) =>
      sql.identifier(column.name),
    );

    return sql`${sql.identifier(name)} AS (SELECT ${sql.join(columns, sql`, `)} FROM ${table} LIMIT 0)`;
  });

  await client.execute(sql`WITH ${sql.join(tableChecks, sql`, `)} SELECT 1`);
};
