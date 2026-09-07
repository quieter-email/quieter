import { db } from "@quieter/database/client";
import { sql } from "drizzle-orm";

export const checkDeploymentDatabase = async () => {
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`set transaction read only`);
    await transaction.execute(sql`set local statement_timeout = '2s'`);
    await transaction.execute(sql`select 1`);
  });
};
